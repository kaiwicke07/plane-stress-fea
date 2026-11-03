// Colormaps. Background: docs/math/07-visualisation.md.
//
// Magnitudes (von Mises, |u|) use a heat ramp with monotonically increasing
// lightness: low values recede into the dark viewport, hot spots are bright.
// Signed stresses use a blue ↔ red diverging map with a neutral grey at zero;
// the red arm's steps match the blue arm's OKLab lightness one for one.
// No rainbow maps: their lightness is not monotone, which invents false edges.

/** Heat ramp (inferno samples, darkest step dropped so zero is not invisible). */
export const HEAT_STOPS = [
  '#1b0c41',
  '#4a0c6b',
  '#781c6d',
  '#a52c60',
  '#cf4446',
  '#ed6925',
  '#fb9b06',
  '#f7d13d',
  '#fcffa4',
] as const;

/** From most negative to most positive; the middle stop is zero. */
export const DIVERGING_STOPS = [
  '#b7d3f6',
  '#6da7ec',
  '#2a78d6',
  '#184f95',
  '#383835',
  '#892b2e',
  '#c7474b',
  '#e48482',
  '#f4c2bf',
] as const;

export type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

/** Colour at t ∈ [0, 1], linearly interpolated between stops. */
export function sampleColormap(stops: readonly string[], t: number): Rgb {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = parseHex(stops[i]);
  const b = parseHex(stops[i + 1]);
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as Rgb;
}

/** RGBA texels for a 1D lookup texture. */
export function colormapTexels(stops: readonly string[], size = 256): Uint8Array {
  const texels = new Uint8Array(4 * size);
  for (let i = 0; i < size; i++) {
    texels.set([...sampleColormap(stops, i / (size - 1)), 255], 4 * i);
  }
  return texels;
}

/**
 * CSS gradient for the legend, bottom to top. With `bands`, each band is a
 * flat colour, matching the banded shader.
 */
export function cssGradient(stops: readonly string[], bands = 0): string {
  const rgb = (c: Rgb) => `rgb(${c.join(' ')})`;
  if (bands <= 0) {
    return `linear-gradient(to top, ${stops.join(', ')})`;
  }
  const parts: string[] = [];
  for (let k = 0; k < bands; k++) {
    const color = rgb(sampleColormap(stops, (k + 0.5) / bands));
    parts.push(`${color} ${((100 * k) / bands).toFixed(3)}%`, `${color} ${((100 * (k + 1)) / bands).toFixed(3)}%`);
  }
  return `linear-gradient(to top, ${parts.join(', ')})`;
}
