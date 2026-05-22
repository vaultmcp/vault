const blocks = [
  {
    headline: 'Built for MCP, not LLM I/O',
    body: 'Other tools scan LLM outputs. Vault scans MCP — the layer every modern agent runs through. It sits between your agent and any MCP server, intercepting every tool response before the agent reads it.',
  },
  {
    headline: 'LLM-grade detection at MCP scale',
    body: 'L0 deterministic decoding + L1 heuristics + L2 embeddings cost-gate the LLM judge so detection stays affordable per request. Use Anthropic, OpenAI, or run fully offline with Ollama.',
  },
  {
    headline: 'Our eval is public',
    body: 'The 80-attack holdout, the 100-document benign set, the limitations, even the postmortem from when we caught our own eval contamination — all published. The numbers above came from a holdout we do not tune against.',
  },
];

export function WhyVault() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <p className="text-xs uppercase tracking-widish text-dim">why vault</p>
        <div className="mt-10 grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-3">
          {blocks.map(({ headline, body }) => (
            <div key={headline} className="bg-bg p-8">
              <h3 className="text-sm font-bold text-ink">{headline}</h3>
              <p className="mt-4 text-sm leading-relaxed text-dim">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
