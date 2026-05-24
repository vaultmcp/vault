/// Scan-only HTTP transport.
/// Exposes a single POST /scan endpoint that runs raw text through the existing
/// detection pipeline (runPipeline) and the existing scanReporter, returning the
/// DetectionResult as JSON. This is not an MCP transport — it is a back-end service
/// used by external callers (e.g. the vaultmcp.io demo site) so that real visitor
/// inputs become real attestations under the same sampling/batching policy as the
/// stdio and http MCP transports.
///
/// Detection logic is reused verbatim. Capability gating, taint tracking, manifest
/// checking, audit logging, and local scan persistence are intentionally not wired
/// here — they all require MCP-protocol context (tool calls, server identifiers,
/// session boundaries) that a free-form scan endpoint doesn't have. Telemetry and
/// attestation are wired because both operate on per-scan verdicts only.

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { loadConfig } from '../config.js';
import { runPipeline } from '../detection/pipeline.js';
import {
  createReporter,
  sha256Hex,
  type TelemetryReporter,
} from '../telemetry/index.js';
import {
  createAttestationClient,
  createScanReporter,
  type AttestationClient,
  type ScanReporter,
} from '../attestation/index.js';

export interface ScanHttpOptions {
  listenPort: number;
  listenHost?: string;
  /// Logical server identifier recorded with each scan (e.g. "https://vaultmcp.io").
  /// Per-request overrides via the serverUrl body field take precedence.
  defaultServerUrl?: string;
}

const DEFAULT_MAX_BODY = 256 * 1024; // 256 KB — comfortably above the demo's 8 KB cap
const MAX_TEXT_BYTES = 256 * 1024;

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

export interface ScanRequestBody {
  text: string;
  toolName?: string;
  serverUrl?: string;
}

function parseRequestBody(raw: string): ScanRequestBody | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'body must be JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'body must be a JSON object' };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.text !== 'string') {
    return { error: 'field "text" is required and must be a string' };
  }
  if (Buffer.byteLength(obj.text, 'utf8') > MAX_TEXT_BYTES) {
    return { error: `field "text" exceeds ${MAX_TEXT_BYTES} bytes` };
  }
  const out: ScanRequestBody = { text: obj.text };
  if (typeof obj.toolName === 'string') out.toolName = obj.toolName;
  if (typeof obj.serverUrl === 'string') out.serverUrl = obj.serverUrl;
  return out;
}

export function startScanHttp(opts: ScanHttpOptions): Server {
  const config = loadConfig();
  const telemetry: TelemetryReporter = createReporter(config.telemetry);
  const attestClient: AttestationClient = createAttestationClient({ config: config.attestation });
  const scanReporter: ScanReporter = createScanReporter({
    client: attestClient,
    sampleRateL1L2: config.attestation.sampleRateL1L2,
  });

  if (config.telemetry.bannerOnStart) {
    process.stderr.write(
      'vault: telemetry is enabled (sha256 hashes only, no raw content) — see PRIVACY.md; set VAULT_TELEMETRY=0 to disable\n',
    );
  }

  const defaultServerUrl = opts.defaultServerUrl ?? 'scan-http:vault';

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    const path = url.split('?')[0] ?? '/';

    if (req.method === 'GET' && (path === '/health' || path === '/')) {
      sendJson(res, 200, {
        ok: true,
        attestEnabled: attestClient.enabled,
        telemetryEnabled: telemetry.enabled,
      });
      return;
    }

    if (req.method !== 'POST' || path !== '/scan') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }

    let bodyBuf: Buffer;
    try {
      bodyBuf = await readBody(req, DEFAULT_MAX_BODY);
    } catch (err) {
      sendJson(res, 413, { error: err instanceof Error ? err.message : 'body read failed' });
      return;
    }

    const parsed = parseRequestBody(bodyBuf.toString('utf8'));
    if ('error' in parsed) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }

    const toolName = parsed.toolName ?? 'scan';
    const serverUrl = parsed.serverUrl ?? defaultServerUrl;
    const contentHash = sha256Hex(parsed.text);

    let result;
    try {
      result = await runPipeline(parsed.text, { toolName });
    } catch (err) {
      process.stderr.write(
        `vault[scan-http]: pipeline failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      sendJson(res, 500, { error: 'pipeline failed' });
      return;
    }

    if (telemetry.enabled) {
      telemetry.send({
        type: 'detection',
        layer: result.layer ?? null,
        verdict: result.verdict,
        confidence: result.confidence,
        toolName,
        contentHash,
        patterns: result.detectedPatterns,
      });
    }

    if (scanReporter.enabled) {
      scanReporter.report({
        toolName,
        mcpServerUrl: serverUrl,
        contentHash,
        result,
        verdict: result.verdict,
        layer: result.layer ?? null,
      });
    }

    if (result.verdict !== 'clean') {
      process.stderr.write(
        `vault[scan-http]: ${result.verdict} (L${result.layer ?? '?'}) tool=${toolName} confidence=${result.confidence.toFixed(2)}\n`,
      );
    }

    sendJson(res, 200, {
      verdict: result.verdict,
      confidence: result.confidence,
      layer: result.layer ?? null,
      reasoning: result.reasoning,
      detectedPatterns: result.detectedPatterns,
      matchedId: result.matchedId,
      matchedCategory: result.matchedCategory,
      distance: result.distance,
      l3Status: result.l3Status,
      contentHash,
      attested: scanReporter.enabled,
    });
  });

  server.listen(opts.listenPort, opts.listenHost ?? '127.0.0.1', () => {
    process.stderr.write(
      `vault[scan-http]: listening on ${opts.listenHost ?? '127.0.0.1'}:${opts.listenPort} (attest=${attestClient.enabled})\n`,
    );
  });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void telemetry.shutdown();
      void attestClient.shutdown();
      server.close(() => process.exit(0));
    });
  }

  return server;
}
