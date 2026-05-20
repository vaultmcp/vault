export function Hero() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-32">
        <div className="flex items-center gap-3 text-xs uppercase tracking-widish text-dim">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" />
          <span>vault — runtime security for mcp</span>
        </div>
        <h1 className="mt-8 max-w-3xl text-4xl font-bold leading-tight md:text-6xl">
          MCP is wide open.
          <br />
          <span className="text-accent">We close it.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base text-dim md:text-lg">
          A drop-in proxy that scans every MCP tool response for prompt injection before your agent
          reasons on it. Three layers of detection, a capability firewall, and a public reputation
          score for every MCP server you connect to.
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
