#!/usr/bin/env node
// rh-demo.mjs — recordable "Guarded on Robinhood Chain" demo. Screen-record it for X.
//
//   node packages/rh-trade/scripts/rh-demo.mjs
//
// It runs a real AI-agent trade through the Vault proxy with the guard on and the Robinhood
// Chain receipt ledger on. An attacker-bound trade gets BLOCKED, a legit one PASSES, and each
// decision is written to Robinhood Chain. The demo prints the blockscout link to the exact
// receipt transaction so you can click through on camera. Everything here is real and onchain.
//
// Reads packages/rh-trade/.env for the attester key (PRIVATE_KEY) + RH RPC. Paced with pauses
// and big labels so it reads well muted.

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../../..'); // repo root
const env = { ...process.env };

// Load packages/rh-trade/.env (real env wins).
const envPath = path.resolve(dir, '../.env');
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const m = raw.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*([^#\s]+)/);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

// A neutral placeholder "your wallet" so a public recording never shows a real trading wallet.
const WALLET = '0x1111111111111111111111111111111111111111';
const ATTACKER = '0x000000000000000000000000000000000000dEaD';
const LEDGER = env.VAULT_RH_LEDGER_CONTRACT || '0x89bf75bccea833fff371fa300f7c885b5c23f103';
const RPC = env.RH_CHAIN_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const SCAN = 'https://robinhoodchain.blockscout.com';
const KEY = env.VAULT_RH_ATTESTER_PRIVATE_KEY || env.PRIVATE_KEY;

Object.assign(env, {
  VAULT_TRADE_GUARD: '1',
  VAULT_TRADE_ALLOWLIST: WALLET,
  VAULT_TRADE_SWAP_TOOLS: 'execute_swap,swap,trade,transfer,send',
  VAULT_RH_LEDGER_CONTRACT: LEDGER,
  VAULT_RH_ATTESTER_PRIVATE_KEY: KEY ? '0x' + String(KEY).replace(/^0x/, '') : '',
  VAULT_RH_LEDGER_RPC_URL: RPC,
});

const C = (s, n) => `\x1b[${n}m${s}\x1b[0m`;
const g = (s) => C(s, '38;2;0;255;102');
const red = (s) => C(s, '31');
const bold = (s) => C(s, '1');
const dim = (s) => C(s, '2;37');
const cy = (s) => C(s, '36');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bar = '─'.repeat(64);
const w = (s = '') => process.stdout.write(s + '\n');

if (!KEY) {
  w(red('\n  No attester key found. Set PRIVATE_KEY in packages/rh-trade/.env (the ledger owner/attester).\n'));
  process.exit(1);
}

// Trivial MCP child. The guard decision + the onchain receipt happen at the proxy layer.
const ECHO = `
const { createInterface } = require('node:readline');
const rl = createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
rl.on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === 'initialize') send({ jsonrpc:'2.0', id:m.id, result:{ protocolVersion:'2024-11-05', capabilities:{tools:{}}, serverInfo:{name:'rh-trade',version:'0'} } });
  else if (m.method === 'tools/list') send({ jsonrpc:'2.0', id:m.id, result:{ tools:[{name:'execute_swap',description:'x',inputSchema:{type:'object'}}] } });
  else if (m.method === 'tools/call') send({ jsonrpc:'2.0', id:m.id, result:{ content:[{type:'text',text:'ok'}] } });
});`;

const child = spawn('node', [path.join(root, 'packages/proxy/dist/index.js'), '--', 'node', '-e', ECHO], {
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
});

// Capture receipt tx hashes from the proxy's rh-ledger stderr, in order.
const receiptTxs = [];
createInterface({ input: child.stderr }).on('line', (l) => {
  const m = l.match(/submitTradeReceipt\s+\S+\s+tx=(0x[0-9a-fA-F]+)/);
  if (m) receiptTxs.push(m[1]);
});

const res = {};
createInterface({ input: child.stdout }).on('line', (l) => {
  try {
    const m = JSON.parse(l);
    if (m.id != null) res[m.id] = m;
  } catch {}
});
const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
const waitRes = async (id, ms = 60000) => {
  const t = Date.now();
  while (!res[id]) {
    if (Date.now() - t > ms) return null;
    await sleep(120);
  }
  return res[id];
};
const call = (id, recipient) =>
  send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'execute_swap', arguments: { symbol: 'WETH', amountIn: '0.05', recipient } } });

// Wait for the next onchain receipt (blocking spinner while it lands).
async function waitReceipt(index, ms = 90000) {
  const t = Date.now();
  process.stdout.write('     ' + dim('writing to Robinhood Chain'));
  while (receiptTxs.length <= index) {
    if (Date.now() - t > ms) {
      w('  ' + dim('(receipt still pending)'));
      return null;
    }
    process.stdout.write(dim('.'));
    await sleep(1000);
  }
  w('');
  return receiptTxs[index];
}

async function main() {
  send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'demo', version: '0' } } });
  await waitRes(0, 20000);

  // ---- Title ----
  w('');
  w('  ' + bold(g('VAULT')) + bold('  ·  Guarded on Robinhood Chain'));
  w('  ' + dim('An AI agent trades onchain. Vault checks every move and writes the proof to the chain.'));
  w('  ' + bar);
  w(`  chain     ${cy('Robinhood Chain (4663)')}`);
  w(`  guard     ${g('ON')}   ${dim('recipient allowlist + taint')}`);
  w(`  ledger    ${cy(LEDGER)}`);
  w(`  board     ${cy('vaultmcp.io/#robinhood')}`);
  w('  ' + bar);
  await sleep(3500);

  // ---- Scene 1: attack ----
  w('');
  w('  ' + bold('1. A poisoned quote tells the agent to send your money to an attacker.'));
  w('     ' + dim(`agent → execute_swap   0.05 WETH → ${ATTACKER}   ${red('(not your wallet)')}`));
  await sleep(2500);
  call(1, ATTACKER);
  const a = await waitRes(1);
  const aText = a?.result?.content?.[0]?.text || '';
  await sleep(600);
  w('     ' + (aText.includes('VAULT_CAPABILITY_BLOCKED')
    ? red('✗ BLOCKED by Vault') + dim('  — the money never moved.')
    : red('unexpected: ') + aText.slice(0, 80)));
  const tx1 = await waitReceipt(0);
  if (tx1) {
    w('     ' + g('receipt written to Robinhood Chain 👉 ') + cy(`${SCAN}/tx/${tx1}`));
  }
  await sleep(3500);

  // ---- Scene 2: legit ----
  w('');
  w('  ' + bold('2. Your real trade, to your own wallet.'));
  w('     ' + dim(`agent → execute_swap   0.05 WETH → ${WALLET}   ${g('(yours)')}`));
  await sleep(2500);
  call(2, WALLET);
  const b = await waitRes(2);
  const passed = !JSON.stringify(b?.result || {}).includes('VAULT_CAPABILITY_BLOCKED');
  await sleep(600);
  w('     ' + (passed ? g('✓ PASSED') + dim('  — Vault allowed it.') : red('blocked (unexpected)')));
  const tx2 = await waitReceipt(1);
  if (tx2) {
    w('     ' + g('receipt written to Robinhood Chain 👉 ') + cy(`${SCAN}/tx/${tx2}`));
  }
  await sleep(3500);

  // ---- Close ----
  w('');
  w('  ' + bar);
  w('  ' + g('Both decisions are now onchain. You do not trust us. You check the chain.'));
  w('     ' + dim('ledger:  ') + cy(`${SCAN}/address/${LEDGER}`));
  w('     ' + dim('board:   ') + cy('vaultmcp.io/#robinhood'));
  w('     ' + dim('cli:     ') + cy('npx @aimcpvault/mcp-proxy check --tool execute_swap'));
  w('  ' + bar);
  w('');
  await sleep(1500);
  child.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  child.kill();
  process.exit(1);
});
