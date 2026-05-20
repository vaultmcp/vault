import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { loadConfig } from '../config.js';
import {
  TaintStore,
  decideCapability,
  type CapabilityConfig,
} from '../capability/index.js';
import {
  ManifestChecker,
  type InitializeResult,
  type ManifestVerdict,
  type ToolsListResult,
} from '../manifest/index.js';
import {
  createReporter,
  sha256Hex,
  type TelemetryReporter,
} from '../telemetry/index.js';
import {
  createAuditLogger,
  preview,
  type AuditLogger,
} from '../audit/index.js';
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
  type ToolCallResult,
} from './shared.js';

function addResponseToTaint(
  msg: JsonRpcMessage & { result: ToolCallResult },
  toolName: string,
  taint: TaintStore,
): void {
  const now = Date.now();
  for (const item of msg.result.content) {
    if (item.type === 'text' && typeof item.text === 'string' && item.text.length > 0) {
      taint.add({ toolName, content: item.text, addedAt: now });
    }
  }
}

function reportManifestVerdict(verdict: ManifestVerdict, mode: 'on' | 'strict'): void {
  const fp = verdict.fingerprint.fingerprint.slice(0, 12);
  const server = verdict.fingerprint.serverName ?? '<unnamed>';
  if (verdict.status === 'first-seen') {
    process.stderr.write(
      `vault: manifest first-seen for '${server}' (fp=${fp}, ${verdict.fingerprint.tools.length} tools)\n`,
    );
    return;
  }
  if (verdict.status === 'unchanged') {
    process.stderr.write(`vault: manifest unchanged for '${server}' (fp=${fp})\n`);
    return;
  }
  // drift
  process.stderr.write(
    `vault: MANIFEST DRIFT for '${server}' (fp=${fp}) — ${verdict.changes.length} change${verdict.changes.length === 1 ? '' : 's'}:\n`,
  );
  for (const c of verdict.changes) process.stderr.write(`vault:   - ${c}\n`);
  if (mode === 'strict') {
    process.stderr.write('vault: strict mode — exiting with code 3\n');
    process.exit(3);
  }
}

/// Build a stable reputation identifier from the upstream command + args. The naive
/// "stdio:<cmd>" collapses every npx-launched server into one bucket, making the on-chain
/// score useless. We append the first non-flag arg (typically the package name or module),
/// stripping path / extension if it's a filesystem path. Examples:
///   npx -y @modelcontextprotocol/server-filesystem /tmp → stdio:npx:@modelcontextprotocol/server-filesystem
///   uvx mcp-server-git                                  → stdio:uvx:mcp-server-git
///   python -m mcp_server_fs                             → stdio:python:mcp_server_fs
///   node /home/user/server.js                           → stdio:node:server
///   npx (bare, no args)                                 → stdio:npx
export function computeServerIdentifier(cmd: string, args: string[]): string {
  let target: string | undefined;
  for (const a of args) {
    if (typeof a !== 'string' || a.length === 0) continue;
    if (a.startsWith('-')) continue;
    target = a;
    break;
  }
  if (!target) return `stdio:${cmd}`;
  // Strip filesystem paths down to basename-without-extension. Scoped npm packages
  // (@scope/name) also contain '/' but should be preserved as-is — distinguish by leading '@'.
  const looksLikePath =
    !target.startsWith('@') &&
    (target.startsWith('/') ||
      target.startsWith('./') ||
      target.startsWith('../') ||
      target.includes('\\'));
  if (looksLikePath) {
    target = path.basename(target).replace(/\.[a-z]+$/i, '');
  }
  return `stdio:${cmd}:${target}`;
}

export function startProxy(cmd: string, args: string[]): void {
  const config = loadConfig();
  const serverIdentifier = computeServerIdentifier(cmd, args);
  const toolNameById = new Map<string | number, string>();
  const taint = new TaintStore(config.capability.windowSize);
  const manifest =
    config.manifest.mode !== 'off' ? new ManifestChecker(cmd, args, config.manifest) : null;
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

  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] });

  child.on('error', (err) => {
    process.stderr.write(`vault: failed to spawn ${cmd}: ${err.message}\n`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  const childStdin = child.stdin;
  const childStdout = child.stdout;
  if (!childStdin || !childStdout) {
    process.stderr.write('vault: child stdio not piped\n');
    process.exit(1);
  }

  // agent → server: capability gate runs here. Sensitive tool calls whose args overlap
  // a tainted source get rewritten into a synthetic [VAULT_CAPABILITY_BLOCKED] response
  // and never reach the server.
  const inRl = createInterface({ input: process.stdin });
  inRl.on('line', (line) => {
    const msg = tryParse(line);
    if (msg && msg.method === 'tools/call' && msg.id != null) {
      const params = msg.params as { name?: unknown; arguments?: unknown } | undefined;
      const name = params && typeof params.name === 'string' ? params.name : null;
      if (name) {
        toolNameById.set(msg.id, name);

        const decision = decideCapability(name, params?.arguments, taint, config.capability);
        if (decision.action !== 'allow' && telemetry.enabled) {
          telemetry.send({
            type: 'capability',
            action: decision.action,
            toolName: name,
            argsHash: sha256Hex(JSON.stringify(params?.arguments ?? null)),
            sourceTools: (decision.taintSources ?? []).map((s) => s.toolName),
            matchedPattern: decision.matchedPattern,
          });
        }
        if (audit.enabled) {
          audit.log({
            type: 'capability',
            toolName: name,
            action: decision.action,
            matchedPattern: decision.matchedPattern,
            taintSources: (decision.taintSources ?? []).map((s) => s.toolName),
            reason: decision.reason,
            argsPreview: preview(JSON.stringify(params?.arguments ?? null)),
          });
        }
        if (decision.action === 'warn') {
          process.stderr.write(
            `vault: capability-warn tool '${name}' (${decision.reason})\n`,
          );
        } else if (decision.action === 'block') {
          process.stderr.write(
            `vault: capability-block tool '${name}' (${decision.reason})\n`,
          );
          const blocked = buildCapabilityBlockedResponse(
            msg.id,
            name,
            decision.reason ?? 'tainted args',
            (decision.taintSources ?? []).map((s) => s.toolName),
          );
          toolNameById.delete(msg.id);
          process.stdout.write(JSON.stringify(blocked) + '\n');
          return; // do NOT forward the original call to the child
        }
      }
    }
    childStdin.write(line + '\n');
  });
  inRl.on('close', () => {
    childStdin.end();
  });

  // server → agent: detection runs here. After mutation (if any), the final content
  // is added to the taint store so subsequent capability checks can see it.
  let chain: Promise<void> = Promise.resolve();
  const outRl = createInterface({ input: childStdout });
  outRl.on('line', (line) => {
    chain = chain.then(async () => {
      const msg = tryParse(line);
      if (!msg) {
        process.stdout.write(line + '\n');
        return;
      }

      if (manifest && msg.result && typeof msg.result === 'object') {
        const result = msg.result as Record<string, unknown>;
        if ('serverInfo' in result || 'protocolVersion' in result) {
          manifest.observeInitialize(result as InitializeResult);
        }
        if ('tools' in result && Array.isArray(result.tools)) {
          manifest.observeToolsList(result as ToolsListResult);
        }
        const verdict = manifest.finalizeIfReady();
        if (verdict) {
          reportManifestVerdict(
            verdict,
            config.manifest.mode === 'strict' ? 'strict' : 'on',
          );
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

      if (isToolCallResponse(msg)) {
        const toolName =
          (msg.id != null ? toolNameById.get(msg.id) : undefined) ?? 'unknown';
        if (msg.id != null) toolNameById.delete(msg.id);

        const outcome = await inspectToolCallResponse(msg, toolName, config.mode);
        if (outcome.verdict !== 'clean') {
          process.stderr.write(
            `vault: ${outcome.verdict} (L${outcome.layer ?? '?'}) response from '${toolName}' (mode=${config.mode}${outcome.mutated ? ', mutated' : ''})\n`,
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
          const previewText = (msg.result.content
            .map((c) => (typeof c.text === 'string' ? c.text : ''))
            .join('\n'));
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
            mcpServerUrl: serverIdentifier,
            contentHash: outcome.contentHash,
            result: outcome.result,
            verdict: outcome.verdict,
            layer: outcome.layer ?? null,
          });
        }
        if (config.capability.enabled) addResponseToTaint(msg, toolName, taint);
      }

      process.stdout.write(JSON.stringify(msg) + '\n');
    });
  });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void telemetry.shutdown();
      void audit.shutdown();
      void attestClient.shutdown();
      if (!child.killed) child.kill(sig);
    });
  }
}

// Re-exported for tests.
export type { CapabilityConfig };
