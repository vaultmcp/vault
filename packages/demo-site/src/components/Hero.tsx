export function Hero() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-32">
        <div className="flex items-center gap-3 text-xs uppercase tracking-widish text-dim">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" />
          <span>vault — runtime security for mcp</span>
        </div>
        <h1 className="mt-8 max-w-3xl text-4xl font-bold leading-tight md:text-6xl">
          A prompt-injection proxy
          <br />
          <span className="text-accent">for MCP.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base text-dim md:text-lg">
          A drop-in proxy that scans MCP tool responses for prompt-injection patterns before they
          reach your agent's context. Layered detection (regex + embeddings + optional LLM judge),
          a capability firewall, and on-chain reputation lookups for the servers you connect to.
          Measured detection: 45.2% TPR / 0.9% FPR on our public 188-attack holdout with L3
          disabled — see LIMITATIONS in the repo for what gets through.
        </p>

        <div className="mt-10 rounded-md border border-line bg-panel p-4 font-mono text-sm">
          <div className="text-dim">$ install</div>
          <div className="mt-1 break-all text-ink">
            <span className="text-accent">npx</span> @vaultmcp/mcp-proxy{' '}
            <span className="text-dim">--</span> npx -y @modelcontextprotocol/server-filesystem /path
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-xs uppercase tracking-widish text-dim">
          <span>three detection layers</span>
          <span>·</span>
          <span>capability firewall</span>
          <span>·</span>
          <span>manifest verification</span>
          <span>·</span>
          <span>on-chain reputation</span>
        </div>
      </div>
    </section>
  );
}
