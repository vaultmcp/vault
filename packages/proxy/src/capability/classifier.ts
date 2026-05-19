/// Built-in classifier for "sensitive" MCP tools — tools whose successful invocation can
/// cause real-world side effects (network egress, filesystem mutation, code execution,
/// messaging, credential disclosure). Pattern matched against the MCP tool's `name` field.
///
/// Override / extend at runtime via VAULT_SENSITIVE_TOOL_PATTERNS (comma-separated regexes).

export const DEFAULT_SENSITIVE_PATTERNS: readonly RegExp[] = [
  // Network egress
  /^https?(_|$)/i,
  /^fetch/i,
  /^request$/i,
  /^(get|post|put|delete|patch|head)_?(url|http|request)?$/i,
  /^http_(get|post|put|delete|patch|head|request)$/i,
  /^url_/i,
  /_url$/i,

  // Messaging / outbound communication
  /^send_/i,
  /^post_(to_|message|notification)/i,
  /^notify/i,
  /^email/i,
  /^slack_/i,
  /^discord_/i,

  // Filesystem mutation
  /^(write|create|append|delete|remove|unlink|mkdir|rmdir|move|rename|copy|symlink)_?(file|dir|directory|path)?$/i,
  /^edit_file/i,
  /^patch_file/i,

  // Code execution
  /^(execute|run|eval|spawn|exec)(_|$)/i,
  /^shell(_|$)/i,
  /^command(_|$)/i,
  /^bash$/i,
  /^run_command$/i,

  // Credentials / secrets
  /^(get|read|fetch|reveal|dump)_?(secret|env|api_?key|credential|token|password)/i,
  /^env(_|$)/i,
];

export interface SensitiveToolClassification {
  sensitive: boolean;
  matchedPattern?: string;
}

export function classifyTool(
  name: string,
  extraPatterns: readonly RegExp[] = [],
): SensitiveToolClassification {
  for (const re of DEFAULT_SENSITIVE_PATTERNS) {
    if (re.test(name)) return { sensitive: true, matchedPattern: re.source };
  }
  for (const re of extraPatterns) {
    if (re.test(name)) return { sensitive: true, matchedPattern: re.source };
  }
  return { sensitive: false };
}
