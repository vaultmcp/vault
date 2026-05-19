/// Manifest fingerprinting — produces a stable hash over the MCP server's identity
/// (initialize response) and capability surface (tools/list response) so subsequent
/// runs can detect drift.

import { createHash } from 'node:crypto';

export interface ToolSummary {
  name: string;
  description?: string;
  inputSchemaHash: string;
}

export interface ManifestFingerprint {
  fingerprint: string;
  serverName?: string;
  serverVersion?: string;
  protocolVersion?: string;
  tools: ToolSummary[];
}

export interface InitializeResult {
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  capabilities?: unknown;
}

export interface ToolEntry {
  name?: string;
  description?: string;
  inputSchema?: unknown;
}

export interface ToolsListResult {
  tools?: ToolEntry[];
}

/// Deterministic JSON stringify: sorts object keys recursively so two semantically
/// equivalent schemas produce the same string (and the same hash).
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value ?? null);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') +
    '}'
  );
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function fingerprintTools(tools: ToolEntry[]): ToolSummary[] {
  const sorted = [...tools].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  return sorted.map((t) => ({
    name: t.name ?? '',
    description: t.description,
    inputSchemaHash: sha256(stableStringify(t.inputSchema ?? null)),
  }));
}

export function computeFingerprint(
  initialize: InitializeResult | null,
  toolsList: ToolsListResult | null,
): ManifestFingerprint {
  const tools = fingerprintTools(toolsList?.tools ?? []);
  const material = {
    protocol: initialize?.protocolVersion ?? '',
    server: {
      name: initialize?.serverInfo?.name ?? '',
      version: initialize?.serverInfo?.version ?? '',
    },
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchemaHash: t.inputSchemaHash,
    })),
  };
  return {
    fingerprint: sha256(stableStringify(material)),
    serverName: initialize?.serverInfo?.name,
    serverVersion: initialize?.serverInfo?.version,
    protocolVersion: initialize?.protocolVersion,
    tools,
  };
}

/// Identifies an MCP server by the command + args used to spawn it. Two invocations
/// with the same command line address the same stored manifest snapshot.
export function serverKey(cmd: string, args: string[]): string {
  return sha256(`${cmd}\u0000${args.join('\u0000')}`).slice(0, 16);
}

/// Returns a human-readable diff summary between two fingerprints. Empty array if identical.
export function diffFingerprints(
  prev: ManifestFingerprint,
  curr: ManifestFingerprint,
): string[] {
  const changes: string[] = [];
  if (prev.serverName !== curr.serverName) {
    changes.push(`server name: ${prev.serverName ?? '<none>'} → ${curr.serverName ?? '<none>'}`);
  }
  if (prev.serverVersion !== curr.serverVersion) {
    changes.push(`server version: ${prev.serverVersion ?? '<none>'} → ${curr.serverVersion ?? '<none>'}`);
  }
  if (prev.protocolVersion !== curr.protocolVersion) {
    changes.push(`protocol version: ${prev.protocolVersion ?? '<none>'} → ${curr.protocolVersion ?? '<none>'}`);
  }

  const prevByName = new Map(prev.tools.map((t) => [t.name, t]));
  const currByName = new Map(curr.tools.map((t) => [t.name, t]));

  for (const [name] of currByName) {
    if (!prevByName.has(name)) changes.push(`tool added: ${name}`);
  }
  for (const [name] of prevByName) {
    if (!currByName.has(name)) changes.push(`tool removed: ${name}`);
  }
  for (const [name, currTool] of currByName) {
    const prevTool = prevByName.get(name);
    if (!prevTool) continue;
    if (prevTool.inputSchemaHash !== currTool.inputSchemaHash) {
      changes.push(`tool '${name}' input schema changed`);
    }
    if (prevTool.description !== currTool.description) {
      changes.push(`tool '${name}' description changed`);
    }
  }

  return changes;
}
