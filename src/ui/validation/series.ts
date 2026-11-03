// Series colours for validation charts: the first three categorical slots of
// the dark palette, validated for colour-vision separation on --surface.
// Analytical references use neutral ink, so "FE vs theory" never relies on hue.
export const SERIES = {
  c1: '#3987e5',
  c2: '#d95926',
  c3: '#199e70',
  reference: 'var(--text)',
  guide: 'var(--text-muted)',
} as const;

export const pct = (v: number, digits = 3) => `${Number((100 * v).toPrecision(digits))}%`.replace('-', '−');
