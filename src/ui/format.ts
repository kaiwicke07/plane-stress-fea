/** Engineering-friendly number formatting: 3 significant figures, exponent for extremes. */
export function formatNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : value < 0 ? '−∞' : '—';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  // Round to significant figures, then print plainly: 1000 stays "1000", not "1.00e+3".
  const text = abs >= 1e5 || abs < 1e-3 ? value.toExponential(digits - 1) : String(Number(value.toPrecision(digits)));
  return text.replace('-', '−');
}

export function formatWithUnit(value: number, unit: string, digits = 3): string {
  return `${formatNumber(value, digits)} ${unit}`;
}
