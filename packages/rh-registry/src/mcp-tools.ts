/// MCP tools that expose the safety registry to an agent in-loop. Before an agent
/// trusts a trading MCP server, it can ask the registry whether Vault has scanned it
/// and what the verdict is — turning the registry from a webpage into a decision an
/// agent can make at runtime.
///
/// Pure over a RegistryStore: the server (mcp-server.ts) owns the store instance and
/// passes it in, so these functions stay testable without I/O.

import type { RegistryStore } from './store.js';
import type { RegistryEntry, ScanStatus } from './types.js';

/// The recommendation an agent should act on.
///  - `allow`   — scanned by Vault, no findings
///  - `caution` — flagged (has findings) OR unscanned; the agent should not blindly trust it
///  - `unknown` — the server is not in the registry at all
export type Recommendation = 'allow' | 'caution' | 'unknown';

export interface ServerVerdict {
  found: boolean;
  recommendation: Recommendation;
  summary: string;
  entry?: RegistryEntry;
}

/// JSON-Schema tool definitions advertised via tools/list.
export const TOOLS = [
  {
    name: 'check_mcp_server',
    description:
      "Check whether Vault has scanned a trading MCP server and whether it's safe to use. " +
      'Look up by registry id or by MCP endpoint/command. Returns a recommendation ' +
      '(allow / caution / unknown) with the scan status and attestation state.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Registry id, e.g. rh-example-official-quotes.' },
        endpoint: { type: 'string', description: 'MCP endpoint URL or stdio launch command.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_mcp_servers',
    description:
      'List registered trading MCP servers and their Vault scan status. Optionally filter ' +
      'by scanStatus (scanned | flagged | unscanned).',
    inputSchema: {
      type: 'object',
      properties: {
        scanStatus: { type: 'string', enum: ['scanned', 'flagged', 'unscanned'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'registry_summary',
    description: 'Aggregate counts across the registry (total, scanned, flagged, unscanned, attestation).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
] as const;

function recommendationFor(status: ScanStatus): Recommendation {
  if (status === 'scanned') return 'allow';
  return 'caution'; // flagged or unscanned
}

/// Find an entry by id, or by matching endpoint/command (case-insensitive).
export function findServer(
  store: RegistryStore,
  q: { id?: string; endpoint?: string },
): RegistryEntry | undefined {
  if (q.id) {
    const byId = store.get(q.id);
    if (byId) return byId;
  }
  if (q.endpoint) {
    const needle = q.endpoint.trim().toLowerCase();
    return store
      .list()
      .find(
        (e) =>
          e.mcpEndpoint?.toLowerCase() === needle ||
          e.mcpCommand?.toLowerCase() === needle ||
          e.id.toLowerCase() === needle,
      );
  }
  return undefined;
}

export function checkServer(store: RegistryStore, q: { id?: string; endpoint?: string }): ServerVerdict {
  if (!q.id && !q.endpoint) {
    return { found: false, recommendation: 'unknown', summary: 'provide an id or endpoint to check' };
  }
  const entry = findServer(store, q);
  if (!entry) {
    return {
      found: false,
      recommendation: 'unknown',
      summary: `not in the registry — Vault has no scan record for ${q.id ?? q.endpoint}. Treat as untrusted.`,
    };
  }
  const rec = recommendationFor(entry.scanStatus);
  const attest =
    entry.attestation.status === 'attested'
      ? `attested on ${entry.attestation.chain ?? 'base'} (${entry.attestation.easUid})`
      : 'attestation pending';
  const summary =
    rec === 'allow'
      ? `${entry.name}: scanned by Vault, no findings; ${attest}.`
      : entry.scanStatus === 'flagged'
        ? `${entry.name}: FLAGGED — Vault found ${entry.findingsCount} issue(s); ${attest}. Do not trust without review.`
        : `${entry.name}: not yet scanned by Vault; ${attest}. Treat as untrusted.`;
  return { found: true, recommendation: rec, summary, entry };
}

export function callRegistryTool(store: RegistryStore, name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'check_mcp_server':
      return checkServer(store, {
        id: typeof args['id'] === 'string' ? args['id'] : undefined,
        endpoint: typeof args['endpoint'] === 'string' ? args['endpoint'] : undefined,
      });
    case 'list_mcp_servers': {
      const filter = args['scanStatus'];
      const entries = store.list();
      const filtered =
        typeof filter === 'string' ? entries.filter((e) => e.scanStatus === filter) : entries;
      return { servers: filtered, count: filtered.length };
    }
    case 'registry_summary':
      return store.summary();
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
