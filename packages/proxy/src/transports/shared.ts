/// Shared scanning + mutation logic used by both stdio and http transports.

import { runPipeline } from '../detection/pipeline.js';
import { rankVerdict, type DetectionResult, type Verdict } from '../detection/types.js';
import { sha256Hex } from '../telemetry/index.js';

export interface JsonRpcMessage {
  jsonrpc?: '2.0';
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface ContentItem {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface ToolCallResult {
  content: ContentItem[];
  isError?: boolean;
  [k: string]: unknown;
}

export type VaultMode = 'block' | 'warn' | 'log';

export interface InspectionOutcome {
  mutated: boolean;
  verdict: Verdict;
  layer?: number;
  result: DetectionResult | null;
  contentHash: string;
}

export function tryParse(line: string): JsonRpcMessage | null {
  try {
    return JSON.parse(line) as JsonRpcMessage;
  } catch {
    return null;
  }
}

export function isToolCallResponse(
  msg: JsonRpcMessage,
): msg is JsonRpcMessage & { result: ToolCallResult } {
  if (!msg.result || typeof msg.result !== 'object') return false;
  const r = msg.result as Partial<ToolCallResult>;
  return Array.isArray(r.content);
}

export function buildBlockedItem(toolName: string, r: DetectionResult): ContentItem {
  return {
    type: 'text',
    text:
      `[VAULT_BLOCKED] Response from tool '${toolName}' was flagged as potential prompt injection. ` +
      `Verdict: ${r.verdict}. Reasoning: ${r.reasoning}. ` +
      `Original content withheld. To override, set VAULT_MODE=warn.`,
  };
}

export function buildWarningItem(toolName: string, r: DetectionResult): ContentItem {
  return {
    type: 'text',
    text:
      `[VAULT_WARNING] Tool '${toolName}' response flagged (${r.verdict}). ` +
      `Reasoning: ${r.reasoning}. Original content follows.`,
  };
}

export function buildCapabilityBlockedResponse(
  id: string | number,
  toolName: string,
  reason: string,
  sourceTools: string[],
): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            `[VAULT_CAPABILITY_BLOCKED] Refused to invoke '${toolName}'. ${reason}. ` +
            `Taint source(s): ${sourceTools.join(', ') || 'unknown'}. ` +
            `To override, set VAULT_CAPABILITY_MODE=warn or unset VAULT_CAPABILITY.`,
        },
      ],
    },
  };
}

/// Inspects a tool-call response: runs the detection pipeline on every text content item,
/// mutates the message in-place based on the worst verdict + the configured mode, and returns
/// a structured outcome the caller can use for telemetry/audit.
export async function inspectToolCallResponse(
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
