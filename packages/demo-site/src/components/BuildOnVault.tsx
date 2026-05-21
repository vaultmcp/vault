'use client';

import { useState } from 'react';

const CONTRACT_ADDRESS = '0x3A977E4D8BA43367cc41BB4695feFF4615fec189';
const BASESCAN_URL = `https://sepolia.basescan.org/address/${CONTRACT_ADDRESS}`;

const SOLIDITY = `interface IVaultReputation {
    // score: 0–1000 (1000 = clean, 0 = fully blocked)
    // totalScans: lifetime scan count for this server
    // totalBlocks: lifetime catch count for this server
    function getScore(string calldata mcpServerUrl)
        external
        view
        returns (uint16 score, uint32 totalScans, uint32 totalBlocks);
}

// Example: gate agent payments on server reputation
IVaultReputation vault = IVaultReputation(${CONTRACT_ADDRESS});
(uint16 score, , ) = vault.getScore("mcp.example.com");
require(score >= 900, "untrusted MCP server");`;

const TYPESCRIPT = `import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

const client = createPublicClient({ chain: baseSepolia, transport: http() });

const { result } = await client.simulateContract({
  address: '${CONTRACT_ADDRESS}',
  abi: [{
    name: 'getScore',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'mcpServerUrl', type: 'string' }],
    outputs: [
      { name: 'score',       type: 'uint16' },
      { name: 'totalScans',  type: 'uint32' },
      { name: 'totalBlocks', type: 'uint32' },
    ],
  }],
  functionName: 'getScore',
  args: ['mcp.example.com'],
});

const [score, totalScans, totalBlocks] = result;
// score is 0–1000; 1000 = fully clean, 0 = fully blocked`;

type Tab = 'solidity' | 'typescript';

export function BuildOnVault() {
  const [tab, setTab] = useState<Tab>('solidity');

  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <p className="text-xs uppercase tracking-widish text-dim">build on vault</p>
        <p className="mt-4 text-sm text-ink">
          Vault writes attestations and reputation scores you can read from any contract or off-chain agent on Base.
        </p>

        <div className="mt-8 rounded-md border border-line bg-panel">
          {/* Tab bar */}
          <div className="flex items-center gap-px border-b border-line">
            {(['solidity', 'typescript'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-xs uppercase tracking-widish transition-colors ${
                  tab === t
                    ? 'border-b-2 border-accent text-accent'
                    : 'text-dim hover:text-ink'
                }`}
              >
                {t}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 px-4 py-2">
              <span className="h-2 w-2 rounded-full bg-bad opacity-60" />
              <span className="h-2 w-2 rounded-full bg-warn opacity-60" />
              <span className="h-2 w-2 rounded-full bg-accent opacity-60" />
            </div>
          </div>

          {/* Code */}
          <pre className="overflow-x-auto px-5 py-5 font-mono text-xs leading-relaxed text-ink">
            {tab === 'solidity' ? SOLIDITY : TYPESCRIPT}
          </pre>
        </div>

        {/* Contract link */}
        <p className="mt-4 text-xs text-dim">
          Contract address (Base Sepolia):{' '}
          <a
            href={BASESCAN_URL}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:opacity-80"
          >
            {CONTRACT_ADDRESS} ↗
          </a>
          {' '}— mainnet address will be published at launch.
        </p>
      </div>
    </section>
  );
}
