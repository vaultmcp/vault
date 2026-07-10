/// The Vault guard. This is the ONLY integration point with the product: every
/// tool response is passed through Vault's real detection pipeline before the
/// agent is allowed to read it. If Vault flags it, the content is withheld and
/// replaced with a safe stub — the injection never reaches the model's context.
///
/// We import the pipeline directly from the proxy package's source, the same way
/// packages/eval does (relative path + tsx), because @aimcpvault/mcp-proxy ships
/// as a CLI bundle with no library exports.

import { runPipeline } from '../../proxy/src/detection/pipeline.js';
import type { DetectionResult } from '../../proxy/src/detection/types.js';
import type { ToolResponse } from './trading-server.js';

export interface GuardOutcome {
  /** The text the agent is allowed to see (original if clean, stub if blocked). */
  safeText: string;
  blocked: boolean;
  result: DetectionResult;
}

const BLOCKED_STUB =
  '[vault: tool response withheld — prompt injection detected and stripped before it ' +
  'reached the agent. Proceeding with the original user instruction only.]';

/** Scan one tool response. Anything not `clean` is withheld. */
export async function guardToolResponse(
  toolName: string,
  resp: ToolResponse,
): Promise<GuardOutcome> {
  const result = await runPipeline(resp.text, {
    toolName,
    mcpMethod: 'tools/call',
  });
  const blocked = result.verdict !== 'clean';
  return {
    safeText: blocked ? BLOCKED_STUB : resp.text,
    blocked,
    result,
  };
}

export { warmupLayer2 } from '../../proxy/src/detection/layer2-embeddings.js';
