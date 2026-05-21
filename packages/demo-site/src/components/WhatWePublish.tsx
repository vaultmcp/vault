const REPO = 'https://github.com/vaultmcp/vault/blob/main';

const artifacts = [
  {
    label: 'The 80-attack eval holdout',
    href: `${REPO}/packages/eval/datasets/holdout-v2-novel/MANIFEST.md`,
  },
  {
    label: 'The 100-document benign set',
    href: `${REPO}/packages/eval/datasets/benign-v2/MANIFEST.md`,
  },
  {
    label: 'Known limitations and failure modes',
    href: `${REPO}/packages/LIMITATIONS.md`,
  },
  {
    label: 'Our methodology postmortem',
    href: `${REPO}/POSTMORTEM-2026-05-20-contamination.md`,
  },
];

export function WhatWePublish() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <p className="text-xs uppercase tracking-widish text-dim">what we publish</p>
        <p className="mt-4 text-sm text-ink">Every claim on this page is backed by a public artifact.</p>
        <p className="mt-2 text-sm text-dim">
          We caught a methodology contamination event during development. Reverted, documented, shipped honest numbers.
          The postmortem is public.
        </p>
        <ul className="mt-8 space-y-3">
          {artifacts.map(({ label, href }) => (
            <li key={label}>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-2 text-sm text-accent hover:opacity-80"
              >
                <span>{label}</span>
                <span className="text-xs opacity-60 transition-opacity group-hover:opacity-100">↗</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
