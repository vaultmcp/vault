export function Install() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-xs uppercase tracking-widish text-dim">install</h2>
        <div className="mt-6 rounded-md border border-line bg-panel p-6 font-mono text-sm">
          <pre className="overflow-x-auto whitespace-pre text-ink">
{`# wrap any stdio MCP server
npx @aimcpvault/mcp-proxy -- npx -y @modelcontextprotocol/server-filesystem /path

# or proxy a remote MCP server
npx @aimcpvault/mcp-proxy --transport http --upstream https://mcp.example.com/v1 --port 8800`}
          </pre>
        </div>
        <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-xs uppercase tracking-widish text-dim">
          <span>built on base · eas attestations · open source · byo llm key</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-xs text-dim">
          <a className="hover:text-accent" href="https://github.com/" target="_blank" rel="noreferrer">
            github
          </a>
          <a className="hover:text-accent" href="#" target="_blank" rel="noreferrer">
            privacy
          </a>
          <a className="hover:text-accent" href="#" target="_blank" rel="noreferrer">
            twitter
          </a>
        </div>
      </div>
    </section>
  );
}
