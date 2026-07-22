// Seed the Robinhood-Chain TradeReceiptLedger with real guarded-trade receipts, by driving
// tool calls through the actual Vault proxy (guard on, RH ledger on). Every receipt is a
// decision the real guard made, submitted on-chain by an allowlisted attester. Used by the
// scheduled workflow (.github/workflows/rh-ledger-seed.yml) to keep the public board fresh
// until real guarded-trade traffic exists.
//
// Env:
//   VAULT_RH_ATTESTER_PRIVATE_KEY  (required) dedicated attester key, allowlisted on the ledger
//   VAULT_RH_LEDGER_CONTRACT       (default: the deployed ledger)
//   VAULT_RH_LEDGER_RPC_URL        (default: RH mainnet RPC)

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const KEY = process.env.VAULT_RH_ATTESTER_PRIVATE_KEY;
if (!KEY) {
  console.error('VAULT_RH_ATTESTER_PRIVATE_KEY is required');
  process.exit(1);
}

const OWN = '0x1111111111111111111111111111111111111111'; // allowlisted "own wallet" for cleared trades
const ATTACKER = '0x000000000000000000000000000000000000dEaD';

const env = {
  ...process.env,
  VAULT_TRADE_GUARD: '1',
  VAULT_TRADE_ALLOWLIST: OWN,
  VAULT_TRADE_SWAP_TOOLS: 'execute_swap,swap,trade,transfer,send',
  VAULT_TRADE_MAX_APPROVAL: '1000000000000000000000000000',
  VAULT_RH_LEDGER_CONTRACT: process.env.VAULT_RH_LEDGER_CONTRACT ?? '0x89bf75bccea833fff371fa300f7c885b5c23f103',
  VAULT_RH_ATTESTER_PRIVATE_KEY: '0x' + String(KEY).replace(/^0x/, ''),
  VAULT_RH_LEDGER_RPC_URL: process.env.VAULT_RH_LEDGER_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com',
};

// A modest, realistic mix each run: mostly cleared, a couple blocked.
const CALLS = [
  ['execute_swap', { symbol: 'WETH', amountIn: '0.01', recipient: OWN, minAmountOut: '0' }],
  ['execute_swap', { symbol: 'WETH', amountIn: '0.02', recipient: OWN, minAmountOut: '0' }],
  ['execute_swap', { symbol: 'WETH', amountIn: '0.03', recipient: OWN, minAmountOut: '0' }],
  ['execute_swap', { symbol: 'WETH', amountIn: '0.05', recipient: ATTACKER, minAmountOut: '0' }], // blocked
  ['approve', { spender: ATTACKER, amount: '115792089237316195423570985008687907853269984665640564039457584007913129639935' }], // blocked
];

// Trivial MCP echo child — the receipt is emitted at the proxy's guard layer before forwarding.
const ECHO = `
const { createInterface } = require('node:readline');
const rl = createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
rl.on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === 'initialize') send({ jsonrpc:'2.0', id:m.id, result:{ protocolVersion:'2024-11-05', capabilities:{tools:{}}, serverInfo:{name:'echo',version:'0'} } });
  else if (m.method === 'tools/list') send({ jsonrpc:'2.0', id:m.id, result:{ tools:[{name:'execute_swap',description:'x',inputSchema:{type:'object'}},{name:'approve',description:'x',inputSchema:{type:'object'}}] } });
  else if (m.method === 'tools/call') send({ jsonrpc:'2.0', id:m.id, result:{ content:[{type:'text',text:'ok'}] } });
});`;

const child = spawn('node', [path.join(ROOT, 'packages/proxy/dist/index.js'), '--', 'node', '-e', ECHO], {
  env,
  stdio: ['pipe', 'pipe', 'inherit'],
});
const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'seed', version: '0' } } });
  await sleep(2000);
  let id = 1;
  for (const [name, args] of CALLS) {
    send({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } });
    console.error(`sent ${name}`);
    await sleep(1500);
  }
  // Hold open so the serialized on-chain submits all land, then exit cleanly.
  console.error('holding open for on-chain submits...');
  await sleep(120000);
  child.kill();
  process.exit(0);
}
main();
