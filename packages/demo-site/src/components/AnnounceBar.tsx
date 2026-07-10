export function AnnounceBar() {
  return (
    <a
      href="#agentic-trading"
      className="group block border-b border-line bg-panel hover:bg-line/40"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-3 px-6 py-2.5 text-xs md:text-sm">
        <span className="pulse-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
        <span className="text-dim">
          <span className="font-bold uppercase tracking-widish text-accent">New</span>
          {'  '}
          Robinhood Chain shipped agent-executed trading.{' '}
          <span className="text-ink">Vault ships the guard for it.</span>
        </span>
        <span className="shrink-0 text-accent opacity-70 transition-opacity group-hover:opacity-100">
          See how ↓
        </span>
      </div>
    </a>
  );
}
