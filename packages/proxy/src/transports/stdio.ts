import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { loadConfig, type VaultMode } from '../config.js';
import { runPipeline } from '../detection/pipeline.js';
import { rankVerdict, type DetectionResult, type Verdict } from '../detection/types.js';
import {
  TaintStore,
  decideCapability,
  type CapabilityConfig,
  type GateDecision,
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

interface JsonRpcMessage {
  jsonrpc?: '2.0';
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface ContentItem {
  type: string;
  text?: string;
  [k: string]: unknown;
}

interface ToolCallResult {
  content: ContentItem[];
  isError?: boolean;
  [k: string]: unknown;
}

function tryParse(line: string): JsonRpcMessage | null {
  try {
    return JSON.parse(line) as JsonRpcMessage;
  } catch {
    return null;
  }
}

function isToolCallResponse(
  msg: JsonRpcMessage,
): msg is JsonRpcMessage & { result: ToolCallResult } {
  if (!msg.result || typeof msg.result !== 'object') return false;
  const r = msg.result as Partial<ToolCallResult>;
  return Array.isArray(r.content);
}

function buildBlockedItem(toolName: string, r: DetectionResult): ContentItem {
  return {
    type: 'text',
    text:
      `[VAULT_BLOCKED] Response from tool '${toolName}' was flagged as potential prompt injection. ` +
      `Verdict: ${r.verdict}. Reasoning: ${r.reasoning}. ` +
      `Original content withheld. To override, set VAULT_MODE=warn.`,
  };
}

function buildWarningItem(toolName: string, r: DetectionResult): ContentItem {
  return {
    type: 'text',
    text:
      `[VAULT_WARNING] Tool '${toolName}' response flagged (${r.verdict}). ` +
      `Reasoning: ${r.reasoning}. Original content follows.`,
  };
}

function buildCapabilityBlockedResponse(
  id: string | number,
  toolName: string,
  decision: GateDecision,
): JsonRpcMessage {
  const sources = decision.taintSources?.map((s) => s.toolName).join(', ') ?? 'unknown';
  return {
    jsonrpc: '2.0',
    id,
    result: {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            `[VAULT_CAPABILITY_BLOCKED] Refused to invoke '${toolName}'. ${decision.reason}. ` +
            `Taint source(s): ${sources}. ` +
            `To override, set VAULT_CAPABILITY_MODE=warn or unset VAULT_CAPABILITY.`,
        },
      ],
    },
  };
}

interface InspectionOutcome {
  mutated: boolean;
  verdict: Verdict;
  layer?: number;
  result: DetectionResult | null;
  contentHash: string;
}

async function inspectResponse(
  msg: JsonRpcMessage & { result: ToolCallResult },
  toolName: string,
  mode: VaultMode,
): Promise<InspectionOutcome> {
  const items = msg.result.content;
  let worst: Verdict = 'clean';
  let worstResult: DetectionResult | null = null;

  const aggText: string[] = [];
  for (const item of items) {
    if (item.type !== 'text' || typeof item.text !== 'string') continue;
    aggText.push(item.text);
    const r = await runPipeline(item.text, { toolName, mcpMethod: 'tools/call' });
    if (rankVerdict(r.verdict) > rankVerdict(worst)) {
      worst = r.verdict;
      worstResult = r;
    }
  }

  const contentHash = sha256Hex(aggText.join('\n'));

  if (worst === 'clean' || !worstResult) {
    return { mutated: false, verdict: 'clean', result: null, contentHash };
  }
  if (mode === 'log') {
    return { mutated: false, verdict: worst, layer: worstResult.layer, result: worstResult, contentHash };
  }

  if (mode === 'warn') {
    msg.result.content = [buildWarningItem(toolName, worstResult), ...items];
    return { mutated: true, verdict: worst, layer: worstResult.layer, result: worstResult, contentHash };
  }

  msg.result.content = [buildBlockedItem(toolName, worstResult)];
  msg.result.isError = true;
  return { mutated: true, verdict: worst, layer: worstResult.layer, result: worstResult, contentHash };
}

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

export function startProxy(cmd: string, args: string[]): void {
  const config = loadConfig();
  const toolNameById = new Map<string | number, string>();
  const taint = new TaintStore(config.capability.windowSize);
  const manifest =
    config.manifest.mode !== 'off' ? new ManifestChecker(cmd, args, config.manifest) : null;
  const telemetry: TelemetryReporter = createReporter(config.telemetry);
  const audit: AuditLogger = createAuditLogger(config.audit);

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
          const blocked = buildCapabilityBlockedResponse(msg.id, name, decision);
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

        const outcome = await inspectResponse(msg, toolName, config.mode);
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
        if (config.capability.enabled) addResponseToTaint(msg, toolName, taint);
      }

      process.stdout.write(JSON.stringify(msg) + '\n');
    });
  });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void telemetry.shutdown();
      void audit.shutdown();
      if (!child.killed) child.kill(sig);
    });
  }
}

// Re-exported for tests.
export type { CapabilityConfig };
