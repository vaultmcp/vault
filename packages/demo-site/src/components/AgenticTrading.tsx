const layers = [
  {
    headline: 'The attack surface',
    body: 'A trading agent decides by reading tool responses — token metadata, price quotes, routing notes. Every one of those is attacker-influenceable, and a hidden instruction can redirect a swap to an attacker or trigger an unlimited approval, inside a flow the user authorized.',
  },
  {
    headline: 'Two layers, not one',
    body: 'Vault scans every tool response for injection before the agent reads it — and then guards the action itself: recipient allowlist, unlimited-approval blocking, and taint (a recipient the agent only learned from a tool response is blocked). The action guard holds even when a novel injection slips past the scanner.',
  },
  {
    headline: 'One flag to enable',
    body: 'The trade guard is off by default and chain-agnostic — it protects the agent, not the chain. Turn it on with a single environment variable, in block or warn mode, with your own recipient allowlist.',
  },
];

export function AgenticTrading() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <p className="text-xs uppercase tracking-widish text-dim">new · agentic trading</p>
        <h2 className="mt-4 max-w-3xl text-2xl font-bold text-ink md:text-3xl">
          When your agent trades, guard the{' '}
          <span className="text-accent glow-accent">action</span>, not just the text.
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-dim">
          Robinhood Chain shipped agent-executed trading. An agent that trades reads
          attacker-influenceable tool output — one poisoned quote can reroute a swap. Vault adds a
          second line of defense that guards the trade itself.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-3">
          {layers.map(({ headline, body }) => (
            <div key={headline} className="bg-bg p-8">
              <h3 className="text-sm font-bold text-ink">{headline}</h3>
              <p className="mt-4 text-sm leading-relaxed text-dim">{body}</p>
            </div>
          ))}
        </div>

        {/* Terminal */}
        <div className="mt-10 rounded-md border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-bad opacity-70" />
            <span className="h-2.5 w-2.5 rounded-full bg-warn opacity-70" />
            <span className="h-2.5 w-2.5 rounded-full bg-accent opacity-70" />
            <span className="ml-2 text-xs text-dim">terminal</span>
          </div>
          <div className="px-5 py-4 font-mono text-sm leading-relaxed">
            <div className="text-dim">
              <span className="text-accent">$</span>{' '}
              <span className="text-ink">VAULT_TRADE_GUARD=1</span>{' '}
              <span className="text-dim">VAULT_TRADE_ALLOWLIST=0xYourWallet</span>
            </div>
            <div className="text-dim">
              {'  '}
              <span className="text-ink">npx @aimcpvault/mcp-proxy@next</span>{' '}
              <span className="text-dim">--</span>{' '}
              <span className="text-dim">&lt;your trading MCP server&gt;</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
