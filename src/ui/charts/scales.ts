// Axis scales and tick generation for the SVG charts.

export type ScaleKind = 'linear' | 'log';

export interface Scale {
  (value: number): number;
  invert(px: number): number;
  ticks: number[];
}

/** Maps [d0, d1] to [r0, r1], linearly or in log10. */
export function makeScale(kind: ScaleKind, [d0, d1]: [number, number], [r0, r1]: [number, number]): Scale {
  const f = kind === 'log' ? Math.log10 : (v: number) => v;
  const g = kind === 'log' ? (v: number) => 10 ** v : (v: number) => v;
  const [a, b] = [f(d0), f(d1)];
  const scale = ((v: number) => r0 + ((f(v) - a) / (b - a)) * (r1 - r0)) as Scale;
  scale.invert = (px) => g(a + ((px - r0) / (r1 - r0)) * (b - a));
  scale.ticks = kind === 'log' ? logTicks(d0, d1) : linearTicks(d0, d1);
  return scale;
}

/** About five ticks on a 1–2–5 step. */
export function linearTicks(min: number, max: number, target = 5): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / target;
  const decade = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * decade).find((s) => s >= raw) ?? 10 * decade;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/** Powers of ten inside the domain; adds 2× and 5× when it spans under two decades. */
export function logTicks(min: number, max: number): number[] {
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const multipliers = hi - lo <= 2 ? [1, 2, 5] : [1];
  const ticks: number[] = [];
  for (let k = lo; k <= hi; k++) {
    for (const m of multipliers) {
      const v = Number((m * 10 ** k).toPrecision(12));
      if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) ticks.push(v);
    }
  }
  return ticks;
}

/** Data extent with padding: 6% of the span for linear, ×/÷ 1.25 for log. */
export function paddedDomain(values: number[], kind: ScaleKind, include: number[] = []): [number, number] {
  const all = [...values, ...include].filter((v) => Number.isFinite(v) && (kind === 'linear' || v > 0));
  let [min, max] = [Math.min(...all), Math.max(...all)];
  if (kind === 'log') return [min / 1.25, max * 1.25];
  if (min === max) [min, max] = [min - 1, max + 1];
  const pad = 0.06 * (max - min);
  return [min - pad, max + pad];
}
