'use client';

import { useState } from 'react';

const CA = '0xf560e14c75a60a21a50c2f3a7a92f15e8a4595c0';

export function CABar() {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(CA).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  return (
    <div className="border-b border-line bg-bg">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-1.5 font-mono text-xs">
        <span className="shrink-0 uppercase tracking-widish text-dim">CA:</span>
        <button
          onClick={copy}
          title="Copy contract address"
          className="group inline-flex items-center gap-2 text-accent transition-opacity hover:opacity-80"
        >
          <span className="break-all">{CA}</span>
          <span className="shrink-0 text-dim group-hover:text-accent">{copied ? '✓ copied' : 'copy'}</span>
        </button>
      </div>
    </div>
  );
}
