/// SVG badge generator — shields.io-style "vault | score: N/1000" badge.
/// Pure, no external deps, ~1KB output. Width auto-fits to score digits.

export interface BadgeInput {
  score: number | null; // null = "unranked"
  totalScans: number;
}

export interface BadgeStyle {
  label: string;
  labelBg: string;
  valueText: string;
  valueBg: string;
}

export function badgeColor(score: number | null, totalScans: number): { name: string; hex: string } {
  if (totalScans === 0 || score === null) return { name: 'unranked', hex: '#9aa1a8' };
  if (score >= 800) return { name: 'safe', hex: '#3fbf6f' }; // green
  if (score >= 500) return { name: 'caution', hex: '#d99e1f' }; // amber
  return { name: 'unsafe', hex: '#e0464b' }; // red
}

export function badgeValueText(score: number | null, totalScans: number): string {
  if (totalScans === 0 || score === null) return 'unranked';
  return `${score}/1000`;
}

/// Character widths in pixels for Verdana 11px. Calibrated to match shields.io rendering.
/// Estimate is conservative — small over-padding is fine, under-padding clips text.
function textWidth(s: string): number {
  let w = 0;
  for (const c of s) {
    if ('iIl|.,:;!'.includes(c)) w += 3.5;
    else if ('rftj'.includes(c)) w += 4.5;
    else if ('1'.includes(c)) w += 6;
    else if ('mw'.includes(c)) w += 9;
    else if ('WM'.includes(c)) w += 10;
    else if (/[0-9A-Z]/.test(c)) w += 7.5;
    else w += 6.5; // lowercase default
  }
  return Math.ceil(w);
}

export function renderBadgeSVG(input: BadgeInput): string {
  const label = 'vault';
  const value = badgeValueText(input.score, input.totalScans);
  const color = badgeColor(input.score, input.totalScans);

  const PAD = 6;
  const HEIGHT = 20;
  const labelWidth = textWidth(label) + PAD * 2;
  const valueWidth = textWidth(value) + PAD * 2;
  const totalWidth = labelWidth + valueWidth;

  // Round corners via rounded mask; clip both halves so the border is single rounded rect.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${HEIGHT}" role="img" aria-label="vault score: ${value}">
  <title>vault score: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".15"/>
    <stop offset="1" stop-opacity=".15"/>
  </linearGradient>
  <mask id="m"><rect width="${totalWidth}" height="${HEIGHT}" rx="3" fill="#fff"/></mask>
  <g mask="url(#m)">
    <rect width="${labelWidth}" height="${HEIGHT}" fill="#1f2328"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="${HEIGHT}" fill="${color.hex}"/>
    <rect width="${totalWidth}" height="${HEIGHT}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>`;
  return svg;
}
