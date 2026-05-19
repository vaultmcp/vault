import { describe, it, expect } from 'vitest';
import { scoreCompetitor } from '../src/runner.js';
import type { Competitor } from '../src/competitors/types.js';
import { SAMPLES, ATTACKS, CLEAN } from '../src/corpus.js';
import { renderMarkdown } from '../src/scoreboard.js';

function fixedCompetitor(name: string, flagAttacks: boolean, flagClean: boolean): Competitor {
  return {
    name,
    async ready() {
      return { ok: true };
    },
    async classify(text: string) {
      const sample = SAMPLES.find((s) => s.text === text);
      const flagged = sample?.label === 'attack' ? flagAttacks : flagClean;
      return { flagged, latencyMs: 1 };
    },
  };
}

describe('scoreCompetitor', () => {
  it('records perfect score for an oracle', async () => {
    const oracle = fixedCompetitor('oracle', true, false);
    const score = await scoreCompetitor(oracle);
    expect(score.ok).toBe(true);
    expect(score.truePositive).toBe(ATTACKS.length);
    expect(score.trueNegative).toBe(CLEAN.length);
    expect(score.tpr).toBe(1);
    expect(score.fpr).toBe(0);
    expect(score.f1).toBe(1);
    expect(score.accuracy).toBe(1);
  });

  it('records all-flag and computes FPR=1 / TPR=1', async () => {
    const trigger = fixedCompetitor('all-flag', true, true);
    const score = await scoreCompetitor(trigger);
    expect(score.tpr).toBe(1);
    expect(score.fpr).toBe(1);
  });

  it('records never-flag and computes TPR=0', async () => {
    const passive = fixedCompetitor('none', false, false);
    const score = await scoreCompetitor(passive);
    expect(score.tpr).toBe(0);
    expect(score.fpr).toBe(0);
    expect(score.f1).toBe(0);
  });

  it('reports not-ready competitors', async () => {
    const unavail: Competitor = {
      name: 'unavail',
      async ready() {
        return { ok: false, reason: 'no key' };
      },
      async classify() {
        return { flagged: false, latencyMs: 0 };
      },
    };
    const score = await scoreCompetitor(unavail);
    expect(score.ok).toBe(false);
    expect(score.reason).toBe('no key');
  });

  it('captures classification errors per-sample without aborting', async () => {
    const flaky: Competitor = {
      name: 'flaky',
      async ready() {
        return { ok: true };
      },
      async classify(text: string) {
        if (text.toLowerCase().includes('ignore')) throw new Error('boom');
        return { flagged: false, latencyMs: 1 };
      },
    };
    const score = await scoreCompetitor(flaky);
    expect(score.ok).toBe(true);
    expect(score.errorCount).toBeGreaterThan(0);
    expect(score.outcomes).toHaveLength(SAMPLES.length);
  });
});

describe('renderMarkdown', () => {
  it('renders a non-empty Markdown scoreboard', async () => {
    const a = await scoreCompetitor(fixedCompetitor('a', true, false));
    const b = await scoreCompetitor(fixedCompetitor('b', false, true));
    const md = renderMarkdown([a, b]);
    expect(md).toMatch(/Vault Red Team/);
    expect(md).toMatch(/\| Competitor \|/);
    expect(md).toMatch(/\| \*\*a\*\* \|/);
  });

  it('lists not-run competitors separately', async () => {
    const ran = await scoreCompetitor(fixedCompetitor('ran', true, false));
    const skipped = await scoreCompetitor({
      name: 'gone',
      async ready() {
        return { ok: false, reason: 'no key' };
      },
      async classify() {
        return { flagged: false, latencyMs: 0 };
      },
    });
    const md = renderMarkdown([ran, skipped]);
    expect(md).toMatch(/## Not run/);
    expect(md).toMatch(/\*\*gone\*\* — no key/);
  });
});
