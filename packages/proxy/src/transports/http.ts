/// HTTP / Streamable-HTTP MCP transport.
/// Listens locally, forwards every POST to a configured upstream MCP URL, scans responses with
/// the same detection pipeline + capability gate + manifest checker + telemetry as the stdio
/// path. Both single-shot JSON responses and Server-Sent Event streams are scanned: SSE events
/// are parsed at event boundaries, JSON-RPC tool-call responses are inspected, mutated if needed,
/// then re-serialized into the SSE stream.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { loadConfig } from '../config.js';
import {
  TaintStore,
  decideCapability,
} from '../capability/index.js';
import {
  ManifestChecker,
  type InitializeResult,
  type ToolsListResult,
} from '../manifest/index.js';
import {
  createReporter,
  sha256Hex,
  type TelemetryReporter,
} from '../telemetry/index.js';
import { createAuditLogger, preview, type AuditLogger } from '../audit/index.js';
import {
  createAttestationClient,
  createScanReporter,
  type AttestationClient,
  type ScanReporter,
} from '../attestation/index.js';
import {
  buildCapabilityBlockedResponse,
  inspectToolCallResponse,
  isToolCallResponse,
  tryParse,
  type JsonRpcMessage,
} from './shared.js';
import { streamScanSse } from './sse-scan.js';

export interface HttpProxyOptions {
  upstream: string;
  listenPort: number;
  listenHost?: string;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function forwardableHeaders(src: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.join(', ');
  }
  return out;
}

async function readBody(req: IncomingMessage, maxBytes = 5 * 1024 * 1024): Promise<Buffer> {
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

export function startHttpProxy(opts: HttpProxyOptions): Server {
  const config = loadConfig();
  const taint = new TaintStore(config.capability.windowSize);
  const manifest =
    config.manifest.mode !== 'off' ? new ManifestChecker('http', [opts.upstream], config.manifest) : null;
  const telemetry: TelemetryReporter = createReporter(config.telemetry);
  const audit: AuditLogger = createAuditLogger(config.audit);
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

  const upstreamUrl = opts.upstream;

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      sendJson(res, 200, { ok: true, upstream: upstreamUrl });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    let bodyBuf: Buffer;
    try {
      bodyBuf = await readBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : 'body read failed' });
      return;
    }

    // Try to parse as a JSON-RPC request so we can capability-gate.
    const reqText = bodyBuf.toString('utf8');
    const reqMsg = tryParse(reqText);
    let toolName: string | null = null;
    let toolArgs: unknown = undefined;

    if (reqMsg?.method === 'tools/call' && reqMsg.id != null) {
      const params = reqMsg.params as { name?: unknown; arguments?: unknown } | undefined;
      if (params && typeof params.name === 'string') {
        toolName = params.name;
        toolArgs = params.arguments;

        const decision = decideCapability(toolName, toolArgs, taint, config.capability);
        if (decision.action !== 'allow' && telemetry.enabled) {
          telemetry.send({
            type: 'capability',
            action: decision.action,
            toolName,
            argsHash: sha256Hex(JSON.stringify(toolArgs ?? null)),
            sourceTools: (decision.taintSources ?? []).map((s) => s.toolName),
            matchedPattern: decision.matchedPattern,
          });
        }
        if (audit.enabled) {
          audit.log({
            type: 'capability',
            toolName,
            action: decision.action,
            matchedPattern: decision.matchedPattern,
            taintSources: (decision.taintSources ?? []).map((s) => s.toolName),
            reason: decision.reason,
            argsPreview: preview(JSON.stringify(toolArgs ?? null)),
          });
        }
        if (decision.action === 'block') {
          process.stderr.write(
            `vault[http]: capability-block tool '${toolName}' (${decision.reason})\n`,
          );
          const blocked = buildCapabilityBlockedResponse(
            reqMsg.id,
            toolName,
            decision.reason ?? 'tainted args',
            (decision.taintSources ?? []).map((s) => s.toolName),
          );
          sendJson(res, 200, blocked);
          return;
        }
        if (decision.action === 'warn') {
          process.stderr.write(
            `vault[http]: capability-warn tool '${toolName}' (${decision.reason})\n`,
          );
        }
      }
    }

    // Forward to upstream.
    let upstreamResp: Response;
    try {
      upstreamResp = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...forwardableHeaders(req.headers) },
        body: reqText,
      });
    } catch (err) {
      process.stderr.write(`vault[http]: upstream fetch failed: ${err}\n`);
      sendJson(res, 502, { error: 'upstream fetch failed' });
      return;
    }

    const upstreamCT = upstreamResp.headers.get('content-type') ?? '';
    // SSE streaming: parse each event and scan tool-call responses inline.
    if (upstreamCT.includes('text/event-stream')) {
      const headers: Record<string, string> = {};
      upstreamResp.headers.forEach((v, k) => {
        if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
      });
      res.writeHead(upstreamResp.status, headers);
      if (!upstreamResp.body) {
        res.end();
        return;
      }
      try {
        await streamScanSse(
          upstreamResp.body,
          {
            toolName,
            mode: config.mode,
            async onScanned(scannedMsg, scannedTool, outcome) {
              if (outcome.verdict !== 'clean') {
                process.stderr.write(
                  `vault[http/sse]: ${outcome.verdict} (L${outcome.layer ?? '?'}) from '${scannedTool}' (mode=${config.mode}${outcome.mutated ? ', mutated' : ''})\n`,
                );
              }
              if (telemetry.enabled) {
                telemetry.send({
                  type: 'detection',
                  layer: outcome.layer ?? null,
                  verdict: outcome.verdict,
                  confidence: outcome.result?.confidence ?? 0,
                  toolName: scannedTool,
                  contentHash: outcome.contentHash,
                  patterns: outcome.result?.detectedPatterns ?? [],
                });
              }
              if (audit.enabled) {
                const previewText = scannedMsg.result.content
                  .map((c) => (typeof c.text === 'string' ? c.text : ''))
                  .join('\n');
                audit.log({
                  type: 'detection',
                  toolName: scannedTool,
                  layer: outcome.layer ?? null,
                  verdict: outcome.verdict,
                  confidence: outcome.result?.confidence ?? 0,
                  patterns: outcome.result?.detectedPatterns ?? [],
                  mode: config.mode,
                  mutated: outcome.mutated,
                  reasoning: outcome.result?.reasoning,
                  contentPreview: preview(previewText),
                });
              }
              if (scanReporter.enabled) {
                scanReporter.report({
                  toolName: scannedTool,
                  mcpServerUrl: upstreamUrl,
                  contentHash: outcome.contentHash,
                  result: outcome.result,
                  verdict: outcome.verdict,
                  layer: outcome.layer ?? null,
                });
              }
              if (config.capability.enabled) {
                for (const item of scannedMsg.result.content) {
                  if (item.type === 'text' && typeof item.text === 'string' && item.text.length > 0) {
                    taint.add({ toolName: scannedTool, content: item.text, addedAt: Date.now() });
                  }
                }
              }
            },
          },
          (chunk) => {
            res.write(chunk);
          },
        );
      } catch (err) {
        process.stderr.write(`vault[http/sse]: stream scan failed: ${err}\n`);
      }
      res.end();
      return;
    }

    // JSON path: scan + mutate as needed.
    let respText: string;
    try {
      respText = await upstreamResp.text();
    } catch (err) {
      sendJson(res, 502, { error: 'upstream read failed' });
      return;
    }

    const respMsg = tryParse(respText);
    if (!respMsg) {
      // Not JSON-RPC — pass through verbatim.
      res.writeHead(upstreamResp.status, { 'Content-Type': upstreamCT || 'application/json' });
      res.end(respText);
      return;
    }

    if (manifest) {
      const result = respMsg.result as Record<string, unknown> | undefined;
      if (result && typeof result === 'object') {
        if ('serverInfo' in result || 'protocolVersion' in result) {
          manifest.observeInitialize(result as InitializeResult);
        }
        if ('tools' in result && Array.isArray(result.tools)) {
          manifest.observeToolsList(result as ToolsListResult);
        }
        const verdict = manifest.finalizeIfReady();
        if (verdict) {
          const fp = verdict.fingerprint.fingerprint.slice(0, 12);
          if (verdict.status === 'drift') {
            process.stderr.write(
              `vault[http]: MANIFEST DRIFT (fp=${fp}, ${verdict.changes.length} changes)\n`,
            );
            for (const c of verdict.changes) process.stderr.write(`vault[http]:   - ${c}\n`);
            if (config.manifest.mode === 'strict') process.exit(3);
          }
          if (telemetry.enabled) {
            telemetry.send({
              type: 'manifest',
              status: verdict.status,
              serverKey: verdict.serverKey,
              fingerprint: verdict.fingerprint.fingerprint,
              changes: verdict.changes,
            });
          }
          if (audit.enabled) {
            audit.log({
              type: 'manifest',
              serverKey: verdict.serverKey,
              fingerprint: verdict.fingerprint.fingerprint,
              status: verdict.status,
              changes: verdict.changes,
            });
          }
        }
      }
    }

    if (isToolCallResponse(respMsg) && toolName) {
      const outcome = await inspectToolCallResponse(respMsg, toolName, config.mode);
      if (outcome.verdict !== 'clean') {
        process.stderr.write(
          `vault[http]: ${outcome.verdict} (L${outcome.layer ?? '?'}) from '${toolName}' (mode=${config.mode}${outcome.mutated ? ', mutated' : ''})\n`,
        );
      }
      if (telemetry.enabled) {
        telemetry.send({
          type: 'detection',
          layer: outcome.layer ?? null,
          verdict: outcome.verdict,
          confidence: outcome.result?.confidence ?? 0,
          toolName,
          contentHash: outcome.contentHash,
          patterns: outcome.result?.detectedPatterns ?? [],
        });
      }
      if (audit.enabled) {
        const previewText = respMsg.result.content
          .map((c) => (typeof c.text === 'string' ? c.text : ''))
          .join('\n');
        audit.log({
          type: 'detection',
          toolName,
          layer: outcome.layer ?? null,
          verdict: outcome.verdict,
          confidence: outcome.result?.confidence ?? 0,
          patterns: outcome.result?.detectedPatterns ?? [],
          mode: config.mode,
          mutated: outcome.mutated,
          reasoning: outcome.result?.reasoning,
          contentPreview: preview(previewText),
        });
      }
      if (scanReporter.enabled) {
        scanReporter.report({
          toolName,
          mcpServerUrl: upstreamUrl,
          contentHash: outcome.contentHash,
          result: outcome.result,
          verdict: outcome.verdict,
          layer: outcome.layer ?? null,
        });
      }
      if (config.capability.enabled) {
        for (const item of respMsg.result.content) {
          if (item.type === 'text' && typeof item.text === 'string' && item.text.length > 0) {
            taint.add({ toolName, content: item.text, addedAt: Date.now() });
          }
        }
      }
    }

    const payload = JSON.stringify(respMsg);
    res.writeHead(upstreamResp.status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload).toString(),
    });
    res.end(payload);
  });

  server.listen(opts.listenPort, opts.listenHost ?? '127.0.0.1', () => {
    process.stderr.write(
      `vault[http]: listening on ${opts.listenHost ?? '127.0.0.1'}:${opts.listenPort} → ${upstreamUrl}\n`,
    );
  });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void telemetry.shutdown();
      void audit.shutdown();
      void attestClient.shutdown();
      server.close(() => process.exit(0));
    });
  }

  return server;
}

export function isJsonRpcMessage(_m: unknown): _m is JsonRpcMessage {
  return true; // re-export guard, mostly for tests
}
