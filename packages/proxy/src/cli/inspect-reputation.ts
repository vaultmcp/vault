/// On-chain reputation reader for `vault inspect`. Reads the VaultReputation contract
/// via viem and returns per-server stats. Viem is lazy-imported so that running other
/// CLIs doesn't pay the viem load cost.

import type { Address, Hex, PublicClient } from 'viem';

export interface RawReputation {
  /** Contract returns score in [0, 1000]. */
  scoreRaw: number;
  totalScans: number;
  totalBlocks: number;
}

export interface ChainOptions {
  rpcUrl: string;
  contractAddress: Address;
  /** Inject a viem PublicClient for tests. */
  client?: PublicClient;
}

const REPUTATION_ABI = [
  {
    name: 'getScore',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'mcpServerUrl', type: 'string' }],
    outputs: [
      { name: 'score', type: 'uint16' },
      { name: 'totalScans', type: 'uint32' },
      { name: 'totalBlocks', type: 'uint32' },
    ],
  },
] as const;

export async function createReputationReader(opts: ChainOptions) {
  let client = opts.client;
  if (!client) {
    const viem = await import('viem');
    const chains = await import('viem/chains');
    const isSepolia = opts.rpcUrl.includes('sepolia') || opts.rpcUrl.includes('84532');
    const chain = isSepolia ? chains.baseSepolia : chains.base;
    client = viem.createPublicClient({ chain, transport: viem.http(opts.rpcUrl) }) as PublicClient;
  }

  async function read(mcpServerUrl: string): Promise<RawReputation> {
    const result = (await client!.readContract({
      address: opts.contractAddress,
      abi: REPUTATION_ABI,
      functionName: 'getScore',
      args: [mcpServerUrl],
    })) as readonly [number, number, number];
    return {
      scoreRaw: Number(result[0]),
      totalScans: Number(result[1]),
      totalBlocks: Number(result[2]),
    };
  }
  return { read };
}

export type Verdict = 'TRUSTED' | 'NEW' | 'CAUTION' | 'UNTRUSTED';

export interface TrustEval {
  verdict: Verdict;
  /** Score normalized to [0, 1]. */
  score: number;
  totalScans: number;
  totalBlocks: number;
  /** blocks / max(1, scans). */
  maliciousRate: number;
}

/// Trust thresholds (transparent, no magic numbers):
///  TRUSTED   = score >= 0.95 AND totalScans >= 100
///  UNTRUSTED = maliciousRate >= 0.10
///  CAUTION   = totalScans >= 10 AND maliciousRate >= 0.01
///  NEW       = totalScans < 10
/// Order: UNTRUSTED > CAUTION > NEW > TRUSTED (the harshest verdict wins).
export function classify(raw: RawReputation): TrustEval {
  const score = raw.scoreRaw / 1000;
  const totalScans = raw.totalScans;
  const totalBlocks = raw.totalBlocks;
  const maliciousRate = totalScans === 0 ? 0 : totalBlocks / totalScans;
  let verdict: Verdict;
  if (maliciousRate >= 0.10) verdict = 'UNTRUSTED';
  else if (totalScans >= 10 && maliciousRate >= 0.01) verdict = 'CAUTION';
  else if (totalScans < 10) verdict = 'NEW';
  else if (score >= 0.95 && totalScans >= 100) verdict = 'TRUSTED';
  else verdict = 'CAUTION'; // ≥10 scans, low FPR, score below 0.95 → mild caution
  return { verdict, score, totalScans, totalBlocks, maliciousRate };
}
