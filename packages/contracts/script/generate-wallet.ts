/// Generates a fresh EOA. Writes the private key to a gitignored .env file under
/// packages/contracts/, prints only the address to stdout (so the address can end up in
/// transcripts safely but the secret does not).
///
/// Usage:
///   pnpm --filter @vaultmcp/contracts tsx script/generate-wallet.ts <sepolia|mainnet>

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function main(): void {
  const network = process.argv[2];
  if (network !== 'sepolia' && network !== 'mainnet') {
    process.stderr.write('Usage: generate-wallet <sepolia|mainnet>\n');
    process.exit(1);
  }

  const envPath = path.resolve(__dirname, '..', `.env.${network}`);
  if (existsSync(envPath)) {
    process.stderr.write(
      `refusing to overwrite ${envPath}; delete it first if you really want to regenerate\n`,
    );
    process.exit(2);
  }

  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address;
  const purpose =
    network === 'sepolia' ? 'sepolia deployer + attester (test ETH only)' : 'mainnet attester';

  const body =
    `# Vault ${purpose}\n` +
    `# Generated ${new Date().toISOString()}\n` +
    `# Address: ${address}\n` +
    `# This file is gitignored. Do not commit. Do not share over chat.\n` +
    `DEPLOYER_PRIVATE_KEY=${pk}\n` +
    `VAULT_ATTESTER_PRIVATE_KEY=${pk}\n` +
    `VAULT_OWNER=${address}\n`;

  writeFileSync(envPath, body, { mode: 0o600 });

  process.stdout.write(`network: ${network}\n`);
  process.stdout.write(`address: ${address}\n`);
  process.stdout.write(`written: ${envPath}\n`);
  process.stdout.write(`source:  source ${envPath} (or: \`set -a && . ${envPath} && set +a\`)\n`);
}

main();
