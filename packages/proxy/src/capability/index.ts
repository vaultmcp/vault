export { TaintStore, type TaintEntry } from './taint.js';
export { classifyTool, DEFAULT_SENSITIVE_PATTERNS } from './classifier.js';
export {
  decideCapability,
  mergeDecisions,
  type CapabilityConfig,
  type CapabilityMode,
  type GateAction,
  type GateDecision,
} from './gate.js';
export { decideTradePolicy, type TradePolicyConfig } from './trade-policy.js';
