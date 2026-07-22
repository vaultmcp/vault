// Deploy TradeReceiptLedger to Robinhood Chain (Arbitrum Orbit L2, chainId 4663).
//
// RH Chain has no EAS, so trade receipts land in this self-contained contract instead of
// the Base/EAS stack. Deploys with viem (mirrors register-schemas.ts) using the Foundry
// build artifact, and records the address in deployments.json under "robinhood-chain".
//
// Usage:
//   DEPLOYER_PRIVATE_KEY=0x... pnpm --filter @vaultmcp/contracts deploy:rh-ledger
//   (optional RH_CHAIN_RPC_URL / RH_CHAIN_ID overrides; defaults below)

import { createPublicClient, createWalletClient, http, defineChain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEPLOYMENTS_PATH = path.resolve(__dirname, "..", "deployments.json");
const ARTIFACT_PATH = path.resolve(__dirname, "..", "out", "TradeReceiptLedger.sol", "TradeReceiptLedger.json");

const RH_CHAIN_ID = Number(process.env.RH_CHAIN_ID ?? "4663");
const RH_RPC_URL = process.env.RH_CHAIN_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

const robinhoodChain = defineChain({
  id: RH_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RH_RPC_URL] } },
});

interface Deployments {
  [network: string]: Record<string, unknown>;
}

function readDeployments(): Deployments {
  if (!existsSync(DEPLOYMENTS_PATH)) return {};
  return JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8")) as Deployments;
}

async function main(): Promise<void> {
  const raw = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!raw) {
    process.stderr.write("DEPLOYER_PRIVATE_KEY (or PRIVATE_KEY) required\n");
    process.exit(1);
  }
  const pk = (`0x${raw.replace(/^0x/, "")}`) as Hex;

  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as {
    abi: unknown[];
    bytecode: { object: Hex };
  };

  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: robinhoodChain, transport: http(RH_RPC_URL) });
  const pub = createPublicClient({ chain: robinhoodChain, transport: http(RH_RPC_URL) });

  const bal = await pub.getBalance({ address: account.address });
  process.stderr.write(`deployer=${account.address} chainId=${RH_CHAIN_ID} balance=${bal} wei\n`);
  if (bal === 0n) {
    process.stderr.write("deployer has zero balance on Robinhood Chain; fund it first\n");
    process.exit(1);
  }

  process.stderr.write("deploying TradeReceiptLedger (owner = deployer)...\n");
  const hash = await wallet.deployContract({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode.object,
    args: [account.address], // constructor(address _owner)
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`deploy failed: status=${receipt.status} tx=${hash}`);
  }
  const address = receipt.contractAddress as Hex;
  process.stderr.write(`  TradeReceiptLedger=${address} tx=${hash} block=${receipt.blockNumber}\n`);

  const d = readDeployments();
  d["robinhood-chain"] = {
    ...(d["robinhood-chain"] ?? {}),
    chainId: RH_CHAIN_ID,
    rpcUrl: RH_RPC_URL,
    tradeReceiptLedger: address,
    // NB: the owner/attester is public on-chain (read owner() on the contract) but we don't
    // record the wallet address here, to avoid linking the repo to a specific wallet.
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(d, null, 2) + "\n");
  process.stdout.write(JSON.stringify(d["robinhood-chain"], null, 2) + "\n");
}

main().catch((err) => {
  process.stderr.write(`deploy-rh-ledger failed: ${err}\n`);
  process.exit(1);
});
