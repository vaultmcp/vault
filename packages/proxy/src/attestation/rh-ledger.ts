/// Robinhood-Chain trade-receipt sink.
///
/// The product trades on Robinhood Chain, so guarded-trade receipts land there — in the
/// self-contained TradeReceiptLedger contract (no EAS; RH is an Arbitrum Orbit L2 with none).
/// Scan/threat attestations still go to Base/EAS via the other client; this one is only for
/// trade receipts.
///
/// Fire-and-forget from the proxy's perspective: submissions are serialized (to avoid nonce
/// collisions) and failures are logged (throttled) and dropped, never delaying the agent.
/// Viem is imported lazily so nothing loads unless a ledger is configured.

import type { Hex } from 'viem';
import type { AttestationItem, TradeReceiptPayload } from './types.js';

export interface RhLedgerConfig {
  enabled: boolean;
  contract?: Hex;
  rpcUrl: string;
  chainId: number;
  privateKey?: Hex;
}

/// Matches the TradeReceiptSink shape emitTradeReceipt expects, plus lifecycle.
export interface RhLedgerClient {
  readonly enabled: boolean;
  enqueueTradeReceipt(item: Extract<AttestationItem, { kind: 'trade' }>): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

/// Actually submit one receipt on-chain; returns the tx hash. Injectable for tests.
export type RhSubmitFn = (config: RhLedgerConfig, payload: TradeReceiptPayload) => Promise<Hex>;

const NOOP: RhLedgerClient = {
  enabled: false,
  enqueueTradeReceipt() {},
  async flush() {},
  async shutdown() {},
};

export interface CreateRhLedgerClientOpts {
  config: RhLedgerConfig;
  submitFn?: RhSubmitFn;
}

export function createRhLedgerClient(opts: CreateRhLedgerClientOpts): RhLedgerClient {
  const { config } = opts;
  if (!config.enabled || !config.contract || !config.privateKey) return NOOP;

  const submit = opts.submitFn ?? defaultRhSubmit;
  let chainP: Promise<void> = Promise.resolve();
  let lastErrorAt = 0;
  let closed = false;

  function announceError(msg: string): void {
    const now = Date.now();
    if (now - lastErrorAt < 60_000) return;
    lastErrorAt = now;
    process.stderr.write(`vault: RH trade-receipt submit failed (${msg}); dropping\n`);
  }

  return {
    enabled: true,
    enqueueTradeReceipt(item) {
      if (closed) return;
      // Serialize so sequential trades don't collide on nonce.
      chainP = chainP.then(async () => {
        try {
          const hash = await submit(config, item.payload);
          process.stderr.write(`vault[rh-ledger]: submitTradeReceipt ${item.payload.toolName} tx=${hash}\n`);
        } catch (err) {
          announceError(err instanceof Error ? (err.message.split('\n')[0] ?? err.message) : String(err));
        }
      });
    },
    async flush() {
      await chainP;
    },
    async shutdown() {
      closed = true;
      await chainP;
    },
  };
}

const LEDGER_ABI = [
  {
    type: 'function',
    name: 'submitTradeReceipt',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'mcpServerUrl', type: 'string' },
      { name: 'toolName', type: 'string' },
      { name: 'decision', type: 'uint8' },
      { name: 'reasonCode', type: 'uint8' },
      { name: 'recipientHash', type: 'bytes32' },
      { name: 'token', type: 'string' },
      { name: 'valueBucket', type: 'uint8' },
      { name: 'guardedAt', type: 'uint64' },
    ],
    outputs: [],
  },
] as const;

let cached: { key: string; wallet: any; pub: any } | null = null;

async function getClients(config: RhLedgerConfig) {
  const cacheKey = `${config.contract}|${config.rpcUrl}|${config.privateKey!.slice(0, 10)}`;
  if (cached && cached.key === cacheKey) return cached;
  const viem = await import('viem');
  const accounts = await import('viem/accounts');
  const chain = viem.defineChain({
    id: config.chainId,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const account = accounts.privateKeyToAccount(config.privateKey!);
  const wallet = viem.createWalletClient({ account, chain, transport: viem.http(config.rpcUrl) });
  const pub = viem.createPublicClient({ chain, transport: viem.http(config.rpcUrl) });
  cached = { key: cacheKey, wallet, pub };
  return cached;
}

export const defaultRhSubmit: RhSubmitFn = async (config, p) => {
  const { wallet, pub } = await getClients(config);
  const hash = await wallet.writeContract({
    address: config.contract!,
    abi: LEDGER_ABI,
    functionName: 'submitTradeReceipt',
    args: [p.mcpServerUrl, p.toolName, p.decision, p.reasonCode, p.recipientHash, p.token, p.valueBucket, p.guardedAt],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') throw new Error(`tx ${hash} reverted`);
  return hash as Hex;
};
