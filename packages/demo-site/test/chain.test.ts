import { describe, it, expect } from 'vitest';
import { parseNetwork, defaultNetwork, rpcUrl, explorerUrl } from '../src/lib/chain';

describe('parseNetwork', () => {
  it('returns "base" exactly when input is "base"', () => {
    expect(parseNetwork('base')).toBe('base');
  });
  it('returns "base-sepolia" when input is "base-sepolia"', () => {
    expect(parseNetwork('base-sepolia')).toBe('base-sepolia');
  });
  it('falls back to defaultNetwork on garbage input', () => {
    expect(parseNetwork('mainnet')).toBe(defaultNetwork());
    expect(parseNetwork(null)).toBe(defaultNetwork());
    expect(parseNetwork(undefined)).toBe(defaultNetwork());
    expect(parseNetwork('')).toBe(defaultNetwork());
  });
});

describe('defaultNetwork', () => {
  it('picks a network we actually have a deployment for', () => {
    const n = defaultNetwork();
    expect(['base', 'base-sepolia']).toContain(n);
  });
});

describe('rpcUrl', () => {
  it('returns the public default when no env override', () => {
    const prev = process.env.VAULT_BASE_RPC_URL;
    delete process.env.VAULT_BASE_RPC_URL;
    expect(rpcUrl('base')).toMatch(/^https:\/\//);
    expect(rpcUrl('base-sepolia')).toMatch(/^https:\/\//);
    if (prev) process.env.VAULT_BASE_RPC_URL = prev;
  });
  it('honors VAULT_BASE_RPC_URL when set', () => {
    process.env.VAULT_BASE_RPC_URL = 'https://my-private-rpc.example';
    expect(rpcUrl('base')).toBe('https://my-private-rpc.example');
    expect(rpcUrl('base-sepolia')).toBe('https://my-private-rpc.example');
    delete process.env.VAULT_BASE_RPC_URL;
  });
});

describe('explorerUrl', () => {
  it('returns basescan.org for mainnet', () => {
    expect(explorerUrl('base')).toBe('https://basescan.org');
  });
  it('returns sepolia.basescan.org for sepolia', () => {
    expect(explorerUrl('base-sepolia')).toBe('https://sepolia.basescan.org');
  });
});
