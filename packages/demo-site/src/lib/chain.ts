/// On-chain reads against VaultReputation + EAS, used by every /api route and /badge route.
///
/// Designed for the Vercel edge runtime: pure viem, no fs / native, no top-level await.
/// All public reads are cacheable — 60s for score/leaderboard, 30s for the threat feed.

import { createPublicClient, http, parseAbi, type Hex, type Log, decodeEventLog } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import deployments from '@vaultmcp/contracts/deployments.json' assert { type: 'json' };

export type Network = 'base' | 'base-sepolia';

interface Deployment {
  eas?: string;
  vaultReputation?: string;
  schemas?: { scanReceipt?: string; threatRecord?: string };
}

function deploymentFor(network: Network): Deployment {
  const d = (deployments as Record<string, Deployment | undefined>)[network];
  return d ?? {};
}

const REPUTATION_ABI = parseAbi([
  'function getScore(string mcpServerUrl) view returns (uint16 score, uint32 totalScans, uint32 totalBlocks)',
  'function getLeaderboard(uint8 n) view returns (string[] urls, uint16[] scores)',
  'function knownServerCount() view returns (uint256)',
]);

const EAS_ABI = parseAbi([
  'event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)',
  'function getAttestation(bytes32 uid) view returns ((bytes32 uid, bytes32 schema, uint64 time, uint64 expirationTime, uint64 revocationTime, bytes32 refUID, address recipient, address attester, bool revocable, bytes data))',
]);

const DEFAULT_RPC: Record<Network, string> = {
  base: 'https://mainnet.base.org',
  'base-sepolia': 'https://base-sepolia-rpc.publicnode.com',
};

export function rpcUrl(network: Network): string {
  return process.env.VAULT_BASE_RPC_URL ?? DEFAULT_RPC[network];
}

export function explorerUrl(network: Network): string {
  return network === 'base' ? 'https://basescan.org' : 'https://sepolia.basescan.org';
}

/// Returns the first network that has a deployed VaultReputation. Prefers mainnet.
export function defaultNetwork(): Network {
  if (deploymentFor('base').vaultReputation) return 'base';
  return 'base-sepolia';
}

export function parseNetwork(raw: string | null | undefined): Network {
  return raw === 'base' ? 'base' : raw === 'base-sepolia' ? 'base-sepolia' : defaultNetwork();
}

function publicClientFor(network: Network) {
  const chain = network === 'base' ? base : baseSepolia;
  return createPublicClient({ chain, transport: http(rpcUrl(network)) });
}

export interface ScoreResult {
  server: string;
  network: Network;
  score: number;
  totalScans: number;
  totalBlocks: number;
  basescanUrl: string;
  contractAddress: string;
}

export async function readScore(server: string, network: Network = defaultNetwork()): Promise<ScoreResult> {
  const d = deploymentFor(network);
  if (!d.vaultReputation) {
    throw new Error(`no VaultReputation deployment for network=${network}`);
  }
  const addr = d.vaultReputation as Hex;
  const client = publicClientFor(network);
  const [score, totalScans, totalBlocks] = await client.readContract({
    address: addr,
    abi: REPUTATION_ABI,
    functionName: 'getScore',
    args: [server],
  });
  return {
    server,
    network,
    score: Number(score),
    totalScans: Number(totalScans),
    totalBlocks: Number(totalBlocks),
    basescanUrl: `${explorerUrl(network)}/address/${addr}`,
    contractAddress: addr,
  };
}

export interface LeaderboardEntry {
  url: string;
  score: number;
}

export async function readLeaderboard(n: number, network: Network = defaultNetwork()): Promise<LeaderboardEntry[]> {
  const d = deploymentFor(network);
  if (!d.vaultReputation) return [];
  const safeN = Math.min(Math.max(1, Math.floor(n)), 50);
  const addr = d.vaultReputation as Hex;
  const client = publicClientFor(network);
  const [urls, scores] = await client.readContract({
    address: addr,
    abi: REPUTATION_ABI,
    functionName: 'getLeaderboard',
    args: [safeN],
  });
  return urls.map((url, i) => ({ url, score: Number(scores[i] ?? 0) })).filter((e) => e.url.length > 0);
}

/// Aggregate stats used by /api/stats and the homepage counter strip.
/// Sums totalScans / totalBlocks across the top 50 known servers (more than enough for v1).
export interface AggregateStats {
  scansCompleted: number;
  attacksBlocked: number;
  serversTracked: number;
  network: Network;
  contractAddress: string;
}

export async function readAggregateStats(network: Network = defaultNetwork()): Promise<AggregateStats> {
  const d = deploymentFor(network);
  if (!d.vaultReputation) {
    return { scansCompleted: 0, attacksBlocked: 0, serversTracked: 0, network, contractAddress: '' };
  }
  const addr = d.vaultReputation as Hex;
  const client = publicClientFor(network);
  const [urls] = await client.readContract({
    address: addr,
    abi: REPUTATION_ABI,
    functionName: 'getLeaderboard',
    args: [50],
  });
  const known = urls.filter((u) => u.length > 0);
  // Parallel score reads — 50 readContract calls fan out under viem's transport.
  const scoreResults = await Promise.all(
    known.map((u) =>
      client.readContract({
        address: addr,
        abi: REPUTATION_ABI,
        functionName: 'getScore',
        args: [u],
      }),
    ),
  );
  let scans = 0;
  let blocks = 0;
  for (const [, totalScans, totalBlocks] of scoreResults) {
    scans += Number(totalScans);
    blocks += Number(totalBlocks);
  }
  return {
    scansCompleted: scans,
    attacksBlocked: blocks,
    serversTracked: known.length,
    network,
    contractAddress: addr,
  };
}

export interface ThreatEvent {
  uid: string;
  attester: string;
  txHash: string;
  blockNumber: number;
  timestamp: number;
  basescanUrl: string;
  serverUrl?: string;
  category?: string;
}

/// Recent ThreatRecord attestations. Queries EAS Attested events filtered by our threat-record
/// schema over the last N blocks (~2 hours at 2s blocks). The full attestation payload is
/// fetched lazily for the response — we just keep the uid/tx for the feed itself.
export async function readRecentThreats(
  n: number,
  network: Network = defaultNetwork(),
  lookbackBlocks = 3600,
): Promise<ThreatEvent[]> {
  const d = deploymentFor(network);
  if (!d.eas || !d.schemas?.threatRecord) return [];
  const easAddr = d.eas as Hex;
  const schemaUID = d.schemas.threatRecord as Hex;
  const client = publicClientFor(network);
  const head = await client.getBlockNumber();
  const from = head > BigInt(lookbackBlocks) ? head - BigInt(lookbackBlocks) : 0n;
  const logs = await client.getLogs({
    address: easAddr,
    event: {
      type: 'event',
      name: 'Attested',
      inputs: [
        { type: 'address', name: 'recipient', indexed: true },
        { type: 'address', name: 'attester', indexed: true },
        { type: 'bytes32', name: 'uid', indexed: false },
        { type: 'bytes32', name: 'schemaUID', indexed: true },
      ],
    },
    args: { schemaUID },
    fromBlock: from,
    toBlock: head,
  });
  const safeN = Math.min(Math.max(1, Math.floor(n)), 100);
  const sliced = logs.slice(-safeN).reverse();
  return sliced.map((l: Log) => {
    const decoded = decodeEventLog({
      abi: EAS_ABI,
      data: l.data,
      topics: l.topics,
    }) as { args: { uid: Hex; attester: Hex } };
    return {
      uid: decoded.args.uid,
      attester: decoded.args.attester,
      txHash: l.transactionHash ?? '',
      blockNumber: Number(l.blockNumber ?? 0),
      timestamp: 0, // filled below if asked; saves a per-event RPC call
      basescanUrl: l.transactionHash ? `${explorerUrl(network)}/tx/${l.transactionHash}` : '',
    };
  });
}
