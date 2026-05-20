#!/usr/bin/env node
// beta:status — quick dashboard for Phase A monitoring
// Usage: node scripts/beta-status.mjs

const COLLECTOR = 'http://vaultmcp.io';
const SEPOLIA_RPC = 'https://base-sepolia-rpc.publicnode.com';
const VAULT_REPUTATION = '0x3A977E4D8BA43367cc41BB4695feFF4615fec189';

async function fetchJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${r.status} from ${url}`);
  return r.json();
}

async function ethCall(to, data) {
  const body = { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] };
  const r = await fetch(SEPOLIA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json();
  return j.result;
}

function hex32ToNumber(hex) {
  if (!hex || hex === '0x') return 0;
  return parseInt(hex.slice(-64), 16);
}

function ts(epoch) {
  return new Date(epoch).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

async function main() {
  console.log('\n=== Vault Beta Status ===', new Date().toISOString(), '\n');

  // 1. Collector stats
  try {
    const stats = await fetchJson(`${COLLECTOR}/stats`);
    console.log('--- Collector (live) ---');
    console.log(`  Total events : ${stats.total}`);
    console.log(`  Last hour    : ${stats.lastHourCount}`);
    console.log(`  By verdict   : clean=${stats.byVerdict.clean} suspicious=${stats.byVerdict.suspicious} malicious=${stats.byVerdict.malicious}`);
    console.log(`  By type      : detection=${stats.byType.detection} capability=${stats.byType.capability} manifest=${stats.byType.manifest}`);
    if (stats.newestTs) console.log(`  Latest event : ${ts(stats.newestTs)}`);
  } catch (e) {
    console.log('  Collector unreachable:', e.message);
  }

  // 2. Feed — latest 10 events
  try {
    const feed = await fetchJson(`${COLLECTOR}/feed?limit=10`);
    console.log('\n--- Latest Feed Events ---');
    if (!feed.events || feed.events.length === 0) {
      console.log('  (no events yet)');
    } else {
      for (const ev of feed.events) {
        const v = ev.verdict ?? '?';
        const t = ev.type ?? '?';
        const when = ev.ts ? ts(ev.ts) : '?';
        console.log(`  [${when}] ${t} verdict=${v}`);
      }
    }
  } catch (e) {
    console.log('  Feed error:', e.message);
  }

  // 3. On-chain: totalScans from VaultReputation.totalScans() selector 0x41b8d8e2
  try {
    const result = await ethCall(VAULT_REPUTATION, '0x41b8d8e2');
    const scans = hex32ToNumber(result);
    console.log('\n--- On-Chain (Base Sepolia) ---');
    console.log(`  VaultReputation: ${VAULT_REPUTATION}`);
    console.log(`  Total scans    : ${scans}`);
  } catch (e) {
    console.log('\n  Chain read error:', e.message);
  }

  console.log('\n--- What to check next ---');
  console.log('  Demo site     : http://vaultmcp.io');
  console.log('  Findings log  : launch-assets/beta-findings.md');
  console.log('  Full eval     : pnpm --filter @vaultmcp/eval run eval -- --set both');
  console.log();
}

main().catch(e => { console.error(e); process.exit(1); });
