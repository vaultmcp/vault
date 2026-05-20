/// Attestation client — batches scan / threat attestations and submits them to EAS via
/// multiAttest on Base. Fire-and-forget from the proxy's perspective: failures are logged
/// (throttled) and dropped, never delaying the agent's response.
///
/// Viem is imported lazily inside the chain-call path so that with VAULT_ATTEST=0 no
/// viem code is loaded. Tests assert this by spying on the chain-submit function.

import { encodeScanReceipt, encodeThreatRecord } from './encoder.js';
import type {
  AttestationAddresses,
  AttestationConfig,
  AttestationItem,
} from './types.js';
import type { Hex } from 'viem';

/// Signature for the function that actually talks to chain. Injectable for tests.
export type SubmitFn = (
  addresses: AttestationAddresses,
  items: AttestationItem[],
) => Promise<{ txHash: Hex; uids: Hex[] }>;

export interface AttestationClient {
  readonly enabled: boolean;
  enqueueScanReceipt(item: Extract<AttestationItem, { kind: 'scan' }>): void;
  enqueueThreatRecord(item: Extract<AttestationItem, { kind: 'threat' }>): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

const NOOP: AttestationClient = {
  enabled: false,
  enqueueScanReceipt() {},
  enqueueThreatRecord() {},
  async flush() {},
  async shutdown() {},
};

export interface CreateAttestationClientOpts {
  config: AttestationConfig;
  submitFn?: SubmitFn; // override for tests
}

export function createAttestationClient(opts: CreateAttestationClientOpts): AttestationClient {
  const { config } = opts;
  if (!config.enabled || !config.addresses || !config.privateKey) return NOOP;

  const submit = opts.submitFn ?? defaultSubmitFn;
  const addresses = config.addresses;

  let buffer: AttestationItem[] = [];
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;
  let lastErrorAt = 0;
  let closed = false;

  function scheduleFlush(): void {
    if (timer || closed) return;
    timer = setTimeout(() => {
      timer = null;
      void flushInternal();
    }, config.flushIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function announceError(msg: string): void {
    const now = Date.now();
    if (now - lastErrorAt < 60_000) return;
    lastErrorAt = now;
    process.stderr.write(`vault: attestation submit failed (${msg}); dropping batch\n`);
  }

  async function flushInternal(): Promise<void> {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    try {
      await submit(addresses, batch);
    } catch (err) {
      announceError(err instanceof Error ? err.message : String(err));
    }
  }

  function enqueue(item: AttestationItem): void {
    if (closed) return;
    buffer.push(item);
    if (buffer.length >= config.batchSize) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      inFlight = (inFlight ?? Promise.resolve()).then(flushInternal);
      return;
    }
    scheduleFlush();
  }

  return {
    enabled: true,
    enqueueScanReceipt(item) {
      enqueue(item);
    },
    enqueueThreatRecord(item) {
      enqueue(item);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await inFlight;
      await flushInternal();
    },
    async shutdown() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await inFlight;
      await flushInternal();
    },
  };
}

/// Real chain submitter. Lazy-imports viem so that with VAULT_ATTEST=0 we never load it.
const EAS_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'schema', type: 'bytes32' },
          {
            components: [
              { name: 'recipient', type: 'address' },
              { name: 'expirationTime', type: 'uint64' },
              { name: 'revocable', type: 'bool' },
              { name: 'refUID', type: 'bytes32' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' },
            ],
            name: 'data',
            type: 'tuple[]',
          },
        ],
        name: 'multiRequests',
        type: 'tuple[]',
      },
    ],
    name: 'multiAttest',
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as Hex;
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

let cachedClients: {
  config: string;
  wallet: any;
  pub: any;
} | null = null;

async function getClients(addresses: AttestationAddresses, rpcUrl: string, privateKey: Hex) {
  const cacheKey = `${addresses.eas}|${rpcUrl}|${privateKey.slice(0, 10)}`;
  if (cachedClients && cachedClients.config === cacheKey) return cachedClients;
  const viem = await import('viem');
  const accounts = await import('viem/accounts');
  const chains = await import('viem/chains');
  const account = accounts.privateKeyToAccount(privateKey);
  const isSepolia = rpcUrl.includes('sepolia') || rpcUrl.includes('84532');
  const chain = isSepolia ? chains.baseSepolia : chains.base;
  const wallet = viem.createWalletClient({ account, chain, transport: viem.http(rpcUrl) });
  const pub = viem.createPublicClient({ chain, transport: viem.http(rpcUrl) });
  cachedClients = { config: cacheKey, wallet, pub };
  return cachedClients;
}

export const defaultSubmitFn: SubmitFn = async (addresses, items) => {
  if (items.length === 0) return { txHash: ZERO_BYTES32, uids: [] };

  const rpcUrl = process.env.VAULT_BASE_RPC_URL ?? 'https://mainnet.base.org';
  const pk = process.env.VAULT_ATTESTER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error('VAULT_ATTESTER_PRIVATE_KEY not set');

  const scans = items.filter((i): i is Extract<AttestationItem, { kind: 'scan' }> => i.kind === 'scan');
  const threats = items.filter(
    (i): i is Extract<AttestationItem, { kind: 'threat' }> => i.kind === 'threat',
  );
  process.stderr.write(`vault[attest]: submitting batch scans=${scans.length} threats=${threats.length}\n`);

  const multiRequests: Array<{
    schema: Hex;
    data: Array<{
      recipient: Hex;
      expirationTime: bigint;
      revocable: boolean;
      refUID: Hex;
      data: Hex;
      value: bigint;
    }>;
  }> = [];

  if (scans.length > 0) {
    multiRequests.push({
      schema: addresses.scanReceiptSchema,
      data: scans.map((s) => ({
        recipient: ZERO_ADDR,
        expirationTime: 0n,
        revocable: false,
        refUID: ZERO_BYTES32,
        data: encodeScanReceipt(s.payload),
        value: 0n,
      })),
    });
  }

  if (threats.length > 0) {
    multiRequests.push({
      schema: addresses.threatRecordSchema,
      data: threats.map((t) => ({
        recipient: ZERO_ADDR,
        expirationTime: 0n,
        revocable: false,
        refUID: ZERO_BYTES32, // EAS validates refUID exists on-chain; receiptRefUID is in the encoded data
        data: encodeThreatRecord(t.payload),
        value: 0n,
      })),
    });
  }

  const { wallet, pub } = await getClients(addresses, rpcUrl, pk);
  const hash = await wallet.writeContract({
    address: addresses.eas,
    abi: EAS_ABI,
    functionName: 'multiAttest',
    args: [multiRequests],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: 2 });

  // Parse Attested events to get UIDs, then relay to VaultReputation.
  process.stderr.write(`vault[attest]: tx=${hash} logs=${receipt.logs.length}\n`);
  if (addresses.vaultReputation && receipt.logs.length > 0) {
    const viem = await import('viem');
    const ATTESTED_TOPIC = viem.keccak256(viem.toHex('Attested(address,address,bytes32,bytes32)'));
    const vrAbi = viem.parseAbi([
      'function submitReceipt(bytes32 uid) external',
      'function submitThreat(bytes32 uid) external',
    ]);
    const scanUids: Hex[] = [];
    const threatUids: Hex[] = [];
    for (const log of receipt.logs) {
      if (log.topics[0] !== ATTESTED_TOPIC) continue;
      const schemaUID = log.topics[3] as Hex | undefined;
      const uid = log.data.slice(0, 66) as Hex; // first 32 bytes of data = uid
      if (schemaUID === addresses.scanReceiptSchema) scanUids.push(uid);
      else if (schemaUID === addresses.threatRecordSchema) threatUids.push(uid);
    }
    process.stderr.write(`vault[attest]: relay scanUids=${scanUids.length} threatUids=${threatUids.length}\n`);
    // Await each receipt before the next call to avoid nonce collisions on rapid sequential txs.
    // Check receipt.status explicitly since waitForTransactionReceipt doesn't throw on on-chain revert.
    // The confirmations:2 wait above ensures the attestation is visible to the RPC's gas estimator.
    for (const uid of scanUids) {
      try {
        const h = await wallet.writeContract({ address: addresses.vaultReputation, abi: vrAbi, functionName: 'submitReceipt', args: [uid] });
        const r = await pub.waitForTransactionReceipt({ hash: h });
        if (r.status === 'reverted') throw new Error(`tx ${h} reverted`);
        process.stderr.write(`vault[attest]: submitReceipt(${uid}) ok\n`);
      } catch (e) {
        process.stderr.write(`vault[attest]: submitReceipt(${uid}) failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}\n`);
      }
    }
    for (const uid of threatUids) {
      try {
        const h = await wallet.writeContract({ address: addresses.vaultReputation, abi: vrAbi, functionName: 'submitThreat', args: [uid] });
        const r = await pub.waitForTransactionReceipt({ hash: h });
        if (r.status === 'reverted') throw new Error(`tx ${h} reverted`);
        process.stderr.write(`vault[attest]: submitThreat(${uid}) ok\n`);
      } catch (e) {
        process.stderr.write(`vault[attest]: submitThreat(${uid}) failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}\n`);
      }
    }
  }

  return { txHash: hash, uids: [] };
};
