import { createPublicClient, http, formatEther } from 'viem';
import { baseSepolia, base } from 'viem/chains';
const network = process.argv[2] ?? 'sepolia';
const chain = network === 'mainnet' ? base : baseSepolia;
const addr = process.argv[3];
if (!addr) { console.error('usage: check-balance <sepolia|mainnet> <address>'); process.exit(1); }
const c = createPublicClient({ chain, transport: http() });
const bal = await c.getBalance({ address: addr as `0x${string}` });
console.log(`${network} balance for ${addr}: ${formatEther(bal)} ETH`);
