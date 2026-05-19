import { classifyTool } from './classifier.js';
import type { TaintEntry, TaintStore } from './taint.js';

export type CapabilityMode = 'block' | 'warn';

export interface CapabilityConfig {
  enabled: boolean;
  mode: CapabilityMode;
  extraPatterns: RegExp[];
  minOverlap: number;
  windowSize: number;
}

export type GateAction = 'allow' | 'block' | 'warn';

export interface GateDecision {
  action: GateAction;
  reason?: string;
  matchedPattern?: string;
  taintSources?: TaintEntry[];
}

const ALLOW: GateDecision = { action: 'allow' };

export function decideCapability(
  toolName: string,
  args: unknown,
  taint: TaintStore,
  config: CapabilityConfig,
): GateDecision {
  if (!config.enabled) return ALLOW;
  if (!toolName) return ALLOW;

  const classification = classifyTool(toolName, config.extraPatterns);
  if (!classification.sensitive) return ALLOW;

  const argText = stringifyArgs(args);
  if (!argText) return ALLOW;

  const sources = taint.matches(argText, config.minOverlap);
  if (sources.length === 0) return ALLOW;

  const firstSource = sources[0]!;
  return {
    action: config.mode,
    reason:
      `tool '${toolName}' is classified as sensitive and its arguments share content ` +
      `with a recent response from '${firstSource.toolName}' ` +
      `(min overlap ${config.minOverlap} chars, ${sources.length} taint source${sources.length === 1 ? '' : 's'})`,
    matchedPattern: classification.matchedPattern,
    taintSources: sources,
  };
}

function stringifyArgs(args: unknown): string {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args);
  } catch {
    return '';
  }
}
