/// Attestation client — batches scan / threat attestations and submits them to EAS via
/// multiAttest on Base. Fire-and-forget from the proxy's perspective: failures are logged
/// (throttled) and dropped, never delaying the agent's response.
///
/// Viem is imported lazily inside the chain-call path so that with VAULT_ATTEST=0 no
/// viem code is loaded. Tests assert this by spying on the chain-submit function.

import { encodeScanReceipt, encodeThreatRecord, encodeTradeReceipt } from './encoder.js';
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
  enqueueTradeReceipt(item: Extract<AttestationItem, { kind: 'trade' }>): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

const NOOP: AttestationClient = {
  enabled: false,
  enqueueScanReceipt() {},
  enqueueThreatRecord() {},
  enqueueTradeReceipt() {},
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
    enqueueTradeReceipt(item) {
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

/// Stamp each ThreatRecord with the real EAS UID of the ScanReceipt it was paired with (matched on
/// `pairedReceiptLocalId`). VaultReputation.submitThreat only skips re-counting the scan when the
/// threat's `receiptRefUID` equals a ScanReceipt UID that submitReceipt already counted; a threat
/// left with a zero (or synthetic) ref makes the contract count the same scan a second time, halving
/// every server's block rate. A threat with no paired receipt in this batch keeps its zero ref — the
/// contract's orphan branch then counts it exactly once. Pure so it can be unit-tested without chain.
export function resolveThreatRefs(
  scans: Array<Extract<AttestationItem, { kind: 'scan' }>>,
  scanUids: Hex[],
  threats: Array<Extract<AttestationItem, { kind: 'threat' }>>,
): Array<Extract<AttestationItem, { kind: 'threat' }>> {
  const uidByLocalId = new Map<string, Hex>();
  scans.forEach((s, i) => {
    const uid = scanUids[i];
    if (uid) uidByLocalId.set(s.localId, uid);
  });
  return threats.map((t) => {
    const real = t.pairedReceiptLocalId ? uidByLocalId.get(t.pairedReceiptLocalId) : undefined;
    if (!real) return t;
    return { ...t, payload: { ...t.payload, receiptRefUID: real } };
  });
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
  const trades = items.filter(
    (i): i is Extract<AttestationItem, { kind: 'trade' }> => i.kind === 'trade',
  );
  process.stderr.write(
    `vault[attest]: submitting batch scans=${scans.length} threats=${threats.length} trades=${trades.length}\n`,
  );

  const { wallet, pub } = await getClients(addresses, rpcUrl, pk);
  const viem = await import('viem');
  const ATTESTED_TOPIC = viem.keccak256(viem.toHex('Attested(address,address,bytes32,bytes32)'));

  // Attest one schema group via multiAttest and return the created attestation UIDs, in request order.
  async function attest(schema: Hex, datas: Hex[]): Promise<{ hash: Hex; uids: Hex[] }> {
    if (datas.length === 0) return { hash: ZERO_BYTES32, uids: [] };
    const hash = await wallet.writeContract({
      address: addresses.eas,
      abi: EAS_ABI,
      functionName: 'multiAttest',
      args: [
        [
          {
            schema,
            data: datas.map((d) => ({
              recipient: ZERO_ADDR,
              expirationTime: 0n,
              revocable: false,
              refUID: ZERO_BYTES32,
              data: d,
              value: 0n,
            })),
          },
        ],
      ],
    });
    // confirmations:2 so the new attestation is visible to the RPC's gas estimator before we relay.
    const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: 2 });
    const uids: Hex[] = [];
    for (const log of receipt.logs) {
      if (log.topics[0] !== ATTESTED_TOPIC) continue;
      if ((log.topics[3] as Hex | undefined) !== schema) continue;
      uids.push(log.data.slice(0, 66) as Hex); // first 32 bytes of data = uid
    }
    process.stderr.write(`vault[attest]: multiAttest tx=${hash} schema=${schema.slice(0, 10)} uids=${uids.length}\n`);
    return { hash, uids };
  }

  // Phase 1: attest ScanReceipts first so their real EAS UIDs exist. VaultReputation.submitThreat
  // dedups the scan counter on the ThreatRecord's receiptRefUID equalling a submitted ScanReceipt
  // UID, so the paired threats must carry that real UID — which only exists after this tx confirms.
  const { uids: scanUids } = await attest(
    addresses.scanReceiptSchema,
    scans.map((s) => encodeScanReceipt(s.payload)),
  );

  // Phase 2: stamp each threat with its paired receipt's real UID, then attest threats.
  const resolvedThreats = resolveThreatRefs(scans, scanUids, threats);
  const { uids: threatUids } = await attest(
    addresses.threatRecordSchema,
    resolvedThreats.map((t) => encodeThreatRecord(t.payload)),
  );

  // Trade receipts attest independently (kept off-chain until a tradeReceiptSchema is configured)
  // and are not relayed to VaultReputation.
  if (trades.length > 0 && addresses.tradeReceiptSchema) {
    await attest(addresses.tradeReceiptSchema, trades.map((t) => encodeTradeReceipt(t.payload)));
  }

  // Relay to VaultReputation: receipts first (each counts one scan), then threats (each counts one
  // block; its paired scan is not re-counted because the receipt's real UID rides in the record).
  if (addresses.vaultReputation && (scanUids.length > 0 || threatUids.length > 0)) {
    const vrAbi = viem.parseAbi([
      'function submitReceipt(bytes32 uid) external',
      'function submitThreat(bytes32 uid) external',
    ]);
    process.stderr.write(`vault[attest]: relay scanUids=${scanUids.length} threatUids=${threatUids.length}\n`);
    // Await each tx before the next to avoid nonce collisions on rapid sequential txs. Check
    // receipt.status explicitly since waitForTransactionReceipt doesn't throw on on-chain revert.
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

  return { txHash: ZERO_BYTES32, uids: [] };
};
