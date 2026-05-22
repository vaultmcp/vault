/// Read Claude Desktop's MCP server configuration from OS-standard paths.
/// macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
/// Linux:   $XDG_CONFIG_HOME/Claude/claude_desktop_config.json (or ~/.config/Claude/...)
/// Windows: %APPDATA%\Claude\claude_desktop_config.json

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { computeServerIdentifier } from '../transports/stdio.js';

export interface McpServerEntry {
  name: string;
  command: string;
  args: string[];
  /** Computed server identifier used as the on-chain reputation key. */
  identifier: string;
  url?: string; // for SSE/http MCP servers if present
}

export interface ClaudeDesktopConfig {
  configPath: string;
  servers: McpServerEntry[];
}

export function defaultConfigPath(plat: NodeJS.Platform = process.platform): string {
  if (plat === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (plat === 'win32') {
    const appdata = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appdata, 'Claude', 'claude_desktop_config.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  return path.join(xdg, 'Claude', 'claude_desktop_config.json');
}

interface RawMcpServer {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

interface RawConfig {
  mcpServers?: Record<string, RawMcpServer>;
}

export function parseConfig(raw: unknown, configPath: string): ClaudeDesktopConfig {
  if (!raw || typeof raw !== 'object') {
    return { configPath, servers: [] };
  }
  const cfg = raw as RawConfig;
  const servers: McpServerEntry[] = [];
  for (const [name, entry] of Object.entries(cfg.mcpServers ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.url && typeof entry.url === 'string') {
      // SSE/HTTP server (newer MCP format)
      servers.push({ name, command: 'http', args: [entry.url], identifier: entry.url, url: entry.url });
      continue;
    }
    if (entry.command && typeof entry.command === 'string') {
      const args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === 'string') : [];
      servers.push({
        name,
        command: entry.command,
        args,
        identifier: computeServerIdentifier(entry.command, args),
      });
    }
  }
  return { configPath, servers };
}

export function readClaudeDesktopConfig(overridePath?: string): ClaudeDesktopConfig {
  const configPath = overridePath ?? defaultConfigPath();
  if (!existsSync(configPath)) {
    return { configPath, servers: [] };
  }
  const text = readFileSync(configPath, 'utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseConfig(raw, configPath);
}
