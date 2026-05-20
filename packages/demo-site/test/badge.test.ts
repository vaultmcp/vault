import { describe, it, expect } from 'vitest';
import { renderBadgeSVG, badgeColor, badgeValueText } from '../src/lib/badge';

describe('badgeColor', () => {
  it('returns unranked grey when totalScans = 0', () => {
    expect(badgeColor(1000, 0).name).toBe('unranked');
    expect(badgeColor(0, 0).name).toBe('unranked');
    expect(badgeColor(null, 0).name).toBe('unranked');
  });

  it('returns green for score >= 800', () => {
    expect(badgeColor(1000, 100).name).toBe('safe');
    expect(badgeColor(800, 100).name).toBe('safe');
  });

  it('returns amber for 500..799', () => {
    expect(badgeColor(799, 100).name).toBe('caution');
    expect(badgeColor(500, 100).name).toBe('caution');
  });

  it('returns red for < 500', () => {
    expect(badgeColor(499, 100).name).toBe('unsafe');
    expect(badgeColor(0, 100).name).toBe('unsafe');
  });

  it('null score with scans treated as unranked', () => {
    // Defensive — readScore always returns a number, but defending the type.
    expect(badgeColor(null, 100).name).toBe('unranked');
  });
});

describe('badgeValueText', () => {
  it('formats as N/1000 when scans > 0', () => {
    expect(badgeValueText(900, 50)).toBe('900/1000');
    expect(badgeValueText(0, 5)).toBe('0/1000');
  });
  it('reads "unranked" when no scans', () => {
    expect(badgeValueText(1000, 0)).toBe('unranked');
    expect(badgeValueText(null, 0)).toBe('unranked');
  });
});

describe('renderBadgeSVG', () => {
  it('produces well-formed SVG', () => {
    const svg = renderBadgeSVG({ score: 850, totalScans: 50 });
    expect(svg).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('contains the score in the value', () => {
    const svg = renderBadgeSVG({ score: 720, totalScans: 50 });
    expect(svg).toContain('720/1000');
  });

  it('renders "unranked" for zero-scan servers', () => {
    const svg = renderBadgeSVG({ score: 1000, totalScans: 0 });
    expect(svg).toContain('unranked');
  });

  it('uses the green hex for safe scores', () => {
    const svg = renderBadgeSVG({ score: 900, totalScans: 10 });
    expect(svg).toContain('#3fbf6f');
  });

  it('uses the red hex for unsafe scores', () => {
    const svg = renderBadgeSVG({ score: 100, totalScans: 10 });
    expect(svg).toContain('#e0464b');
  });

  it('uses the grey hex for unranked', () => {
    const svg = renderBadgeSVG({ score: 0, totalScans: 0 });
    expect(svg).toContain('#9aa1a8');
  });

  it('keeps SVG under 1KB', () => {
    const svg = renderBadgeSVG({ score: 1000, totalScans: 1000000 });
    expect(svg.length).toBeLessThan(1024);
  });

  it('width auto-fits to longer value text', () => {
    const short = renderBadgeSVG({ score: 5, totalScans: 1 });
    const long = renderBadgeSVG({ score: 1000, totalScans: 1 });
    const shortWidth = Number(short.match(/^<svg[^>]*width="(\d+)"/)?.[1] ?? 0);
    const longWidth = Number(long.match(/^<svg[^>]*width="(\d+)"/)?.[1] ?? 0);
    expect(longWidth).toBeGreaterThanOrEqual(shortWidth);
  });

  it('sets aria-label for accessibility', () => {
    const svg = renderBadgeSVG({ score: 900, totalScans: 10 });
    expect(svg).toContain('aria-label');
  });

  it('validates as XML when parsed', () => {
    const svg = renderBadgeSVG({ score: 600, totalScans: 100 });
    // Very loose XML check — no DOMParser in node, so we sanity-check tag pairing.
    const opens = (svg.match(/<[a-z]/g) ?? []).length;
    const closes = (svg.match(/<\/[a-z]/g) ?? []).length;
    const selfClose = (svg.match(/\/>/g) ?? []).length;
    expect(opens).toBe(closes + selfClose);
  });
});
