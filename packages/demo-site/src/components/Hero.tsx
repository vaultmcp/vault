export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line hero-glow grid-bg">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-36">

        {/* Eyebrow */}
        <div className="flex items-center gap-2.5 text-xs uppercase tracking-widish text-dim">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          <span>private beta · vaultmcp</span>
        </div>

        {/* Headline */}
        <h1 className="mt-10 max-w-4xl">
          <span className="block text-5xl font-bold leading-none md:text-7xl lg:text-8xl text-ink">
            Stop prompt
          </span>
          <span className="block text-5xl font-bold leading-none md:text-7xl lg:text-8xl text-accent glow-accent">
            injection in MCP.
          </span>
        </h1>

        {/* Stat line */}
        <p className="mt-8 text-base text-dim md:text-lg">
          <span className="text-ink font-bold">100% detection rate</span> on our 80-attack public eval
          (95.5%+ lower bound at 95% confidence).{' '}
          <span className="text-ink font-bold">0.0% false positive rate</span> on 100 benign documents.
          <br className="hidden md:block" />
          {' '}Drop-in proxy — zero config change to your agent or MCP server.
        </p>

        {/* Install */}
        <div className="mt-10 rounded-md border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-bad opacity-70" />
            <span className="h-2.5 w-2.5 rounded-full bg-warn opacity-70" />
            <span className="h-2.5 w-2.5 rounded-full bg-accent opacity-70" />
            <span className="ml-2 text-xs text-dim">terminal</span>
          </div>
          <div className="px-5 py-4 font-mono text-sm">
            <div className="text-dim">
              <span className="text-accent">$</span>{' '}
              <span className="text-ink">
                npx @aimcpvault/mcp-proxy@beta{' '}
                <span className="text-dim">--</span>{' '}
                npx -y @modelcontextprotocol/server-filesystem /path
              </span>
            </div>
          </div>
        </div>

        {/* Stat pills */}
        <div className="mt-8 flex flex-wrap gap-3">
          {[
            { label: '100% TPR · 95.5%+ CI', accent: true },
            { label: '0.0% FPR', accent: false },
            { label: '80 / 80 caught', accent: false },
            { label: 'L1 · L2 · L3', accent: false },
            { label: 'Base / EAS', accent: false },
          ].map(({ label, accent }) => (
            <span
              key={label}
              className={`rounded-sm border px-3 py-1 text-xs uppercase tracking-widish ${
                accent
                  ? 'border-accent text-accent glow-accent-sm'
                  : 'border-line text-dim'
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
