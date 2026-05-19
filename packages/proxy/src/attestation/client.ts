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
  // Use Base mainnet by default; callers route via rpcUrl env to point at Sepolia.
  const wallet = viem.createWalletClient({ account, chain: chains.base, transport: viem.http(rpcUrl) });
  const pub = viem.createPublicClient({ chain: chains.base, transport: viem.http(rpcUrl) });
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
        refUID: t.payload.receiptRefUID,
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
  await pub.waitForTransactionReceipt({ hash });
  // We don't decode UIDs here; the contract returns them but they'd require log parsing.
  // VaultReputation can be fed via submitReceipt/submitThreat in a follow-up.
  return { txHash: hash, uids: [] };
};
