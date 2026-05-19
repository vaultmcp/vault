// Register the two Vault EAS schemas on Base (mainnet or Sepolia).
// Output schema UIDs are written into deployments.json so the Deploy.s.sol script
// and the proxy can pick them up.
//
// Usage:
//   DEPLOYER_PRIVATE_KEY=0x... VAULT_RPC_URL=https://... \
//   pnpm --filter @vault/contracts register:schemas base-sepolia
//
// We use viem directly (not @ethereum-attestation-service/eas-sdk) to avoid pulling ethers.js
// into the toolchain — the SchemaRegistry.register surface is tiny.

import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEPLOYMENTS_PATH = path.resolve(__dirname, '..', 'deployments.json');

const SCHEMA_REGISTRY: Hex = '0x4200000000000000000000000000000000000020';
const EAS_ADDRESS: Hex = '0x4200000000000000000000000000000000000021';
const ZERO_ADDR: Hex = '0x0000000000000000000000000000000000000000';

const SCAN_RECEIPT_SCHEMA =
  'bytes32 contentHash,string mcpServerUrl,string toolName,uint8 verdict,uint8 confidence,uint8 layersRun,string[] detectedPatterns,uint64 scannedAt';

const THREAT_RECORD_SCHEMA =
  'bytes32 contentHash,string mcpServerUrl,string toolName,string category,bytes32 receiptRefUID,uint64 detectedAt';

const ABI = parseAbi([
  'function register(string schema, address resolver, bool revocable) returns (bytes32)',
  'event Registered(bytes32 indexed uid, address indexed registerer, (bytes32 uid, address resolver, bool revocable, string schema) schemaRecord)',
]);

interface Deployments {
  [network: string]: {
    eas?: Hex;
    schemaRegistry?: Hex;
    schemas?: { scanReceipt?: Hex; threatRecord?: Hex };
    vaultReputation?: Hex;
    deployedAt?: string;
  };
}

function readDeployments(): Deployments {
  if (!existsSync(DEPLOYMENTS_PATH)) return {};
  return JSON.parse(readFileSync(DEPLOYMENTS_PATH, 'utf8')) as Deployments;
}

function writeDeployments(d: Deployments): void {
  writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(d, null, 2) + '\n');
}

async function main(): Promise<void> {
  const networkArg = process.argv[2];
  if (networkArg !== 'base' && networkArg !== 'base-sepolia') {
    process.stderr.write('Usage: register-schemas <base|base-sepolia>\n');
    process.exit(1);
  }
  const chain = networkArg === 'base' ? base : baseSepolia;

  const pk = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  if (!pk) {
    process.stderr.write('DEPLOYER_PRIVATE_KEY required\n');
    process.exit(1);
  }

  const rpcUrl = process.env.VAULT_RPC_URL ?? chain.rpcUrls.default.http[0];
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });

  process.stderr.write(`network=${networkArg} chainId=${chain.id} attester=${account.address}\n`);

  const uids: { scanReceipt?: Hex; threatRecord?: Hex } = {};

  for (const [name, schema] of [
    ['scanReceipt', SCAN_RECEIPT_SCHEMA],
    ['threatRecord', THREAT_RECORD_SCHEMA],
  ] as const) {
    process.stderr.write(`registering ${name}...\n`);
    const hash = await wallet.writeContract({
      address: SCHEMA_REGISTRY,
      abi: ABI,
      functionName: 'register',
      args: [schema, ZERO_ADDR, false],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`register ${name} reverted: ${hash}`);
    const log = receipt.logs.find(
      (l) => l.address.toLowerCase() === SCHEMA_REGISTRY.toLowerCase() && l.topics.length >= 2,
    );
    if (!log || !log.topics[1]) throw new Error(`no Registered log for ${name}`);
    const uid = log.topics[1] as Hex;
    uids[name] = uid;
    process.stderr.write(`  uid=${uid} tx=${hash}\n`);
  }

  const d = readDeployments();
  d[networkArg] = {
    ...(d[networkArg] ?? {}),
    eas: EAS_ADDRESS,
    schemaRegistry: SCHEMA_REGISTRY,
    schemas: { scanReceipt: uids.scanReceipt!, threatRecord: uids.threatRecord! },
    deployedAt: new Date().toISOString(),
  };
  writeDeployments(d);

  process.stdout.write(JSON.stringify(d[networkArg], null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`register-schemas failed: ${err}\n`);
  process.exit(1);
});
