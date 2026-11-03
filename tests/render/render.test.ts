import { describe, expect, it } from 'vitest';
import { cssGradient, DIVERGING_STOPS, HEAT_STOPS, sampleColormap } from '../../src/render/colormap';
import { fieldRange } from '../../src/render/fields';
import { deformedPositions, locate } from '../../src/render/probe';
import { clipMatrix, fitView, panBy, screenToWorld, worldToScreen, zoomAt } from '../../src/render/view';

/** Relative luminance-ish lightness proxy, enough to check ordering. */
const lightness = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('colormaps', () => {
  it('heat ramp gets lighter monotonically', () => {
    let previous = -1;
    for (let k = 0; k <= 20; k++) {
      const l = lightness(sampleColormap(HEAT_STOPS, k / 20));
      expect(l).toBeGreaterThan(previous);
      previous = l;
    }
  });

  it('diverging map is darkest at zero and symmetric in lightness', () => {
    const mid = lightness(sampleColormap(DIVERGING_STOPS, 0.5));
    for (const d of [0.1, 0.25, 0.4, 0.5]) {
      const neg = lightness(sampleColormap(DIVERGING_STOPS, 0.5 - d));
      const pos = lightness(sampleColormap(DIVERGING_STOPS, 0.5 + d));
      expect(neg).toBeGreaterThan(mid);
      expect(pos).toBeGreaterThan(mid);
      expect(Math.abs(neg - pos) / Math.max(neg, pos)).toBeLessThan(0.15);
    }
  });

  it('clamps outside [0, 1] and hits the end stops exactly', () => {
    expect(sampleColormap(HEAT_STOPS, -1)).toEqual([0x1b, 0x0c, 0x41]);
    expect(sampleColormap(HEAT_STOPS, 2)).toEqual([0xfc, 0xff, 0xa4]);
  });

  it('builds a banded legend gradient with hard stops', () => {
    const css = cssGradient(HEAT_STOPS, 4);
    expect(css.startsWith('linear-gradient(to top,')).toBe(true);
    expect(css.match(/rgb\(/g)?.length).toBe(8);
  });
});

describe('fieldRange', () => {
  it('starts magnitudes at zero and centres signed fields on zero', () => {
    expect(fieldRange(Float64Array.from([3, 7, 5]), false)).toEqual([0, 7]);
    expect(fieldRange(Float64Array.from([-2, 9, 1]), true)).toEqual([-9, 9]);
    expect(fieldRange(new Float64Array(3), true)).toEqual([-1, 1]);
  });
});

describe('view', () => {
  const view = fitView({ minX: 0, minY: -10, maxX: 100, maxY: 10 }, 800, 400, 0.1);

  it('fits the limiting dimension with padding', () => {
    expect(view.zoom).toBeCloseTo((800 * 0.8) / 100, 12); // width limits: 6.4 px/mm
    expect(worldToScreen(view, 50, 0)).toEqual([400, 200]);
  });

  it('inverts between world and screen', () => {
    const [x, y] = screenToWorld(view, ...worldToScreen(view, 12.5, -3.25));
    expect(x).toBeCloseTo(12.5, 12);
    expect(y).toBeCloseTo(-3.25, 12);
  });

  it('zooms about the cursor without moving the point under it', () => {
    const before = screenToWorld(view, 123, 77);
    const after = screenToWorld(zoomAt(view, 123, 77, 2.5), 123, 77);
    expect(after[0]).toBeCloseTo(before[0], 10);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });

  it('pans with the drag direction (y up in world)', () => {
    const moved = panBy(view, 10, 10);
    const [sx, sy] = worldToScreen(moved, 50, 0);
    expect(sx).toBeCloseTo(410, 10);
    expect(sy).toBeCloseTo(210, 10);
  });

  it('maps the view centre to clip (0, 0) and the right edge to clip x = 1', () => {
    const m = clipMatrix(view);
    const clip = (x: number, y: number) => [m[0] * x + m[3] * y + m[6], m[1] * x + m[4] * y + m[7]];
    expect(clip(50, 0)[0]).toBeCloseTo(0, 6);
    expect(clip(50, 0)[1]).toBeCloseTo(0, 6);
    expect(clip(...screenToWorld(view, 800, 0))[0]).toBeCloseTo(1, 6);
    expect(clip(...screenToWorld(view, 800, 0))[1]).toBeCloseTo(1, 6);
  });
});

describe('probe', () => {
  // Two triangles making the unit square.
  const nodes = Float64Array.from([0, 0, 1, 0, 1, 1, 0, 1]);
  const elements = Uint32Array.from([0, 1, 2, 0, 2, 3]);

  it('finds the containing element and barycentric weights', () => {
    const hit = locate(nodes, elements, 0.75, 0.25);
    expect(hit?.element).toBe(0);
    const [l1, l2, l3] = hit!.weights;
    expect(l1 + l2 + l3).toBeCloseTo(1, 14);
    // Reconstruct the point from the weights.
    expect(l1 * 0 + l2 * 1 + l3 * 1).toBeCloseTo(0.75, 14);
    expect(l1 * 0 + l2 * 0 + l3 * 1).toBeCloseTo(0.25, 14);
    expect(locate(nodes, elements, 0.2, 0.8)?.element).toBe(1);
  });

  it('returns null outside the mesh', () => {
    expect(locate(nodes, elements, 1.5, 0.5)).toBeNull();
  });

  it('locates in the deformed configuration', () => {
    const u = Float64Array.from([0, 0, 1, 0, 1, 0, 0, 0]); // stretch right side by 1 mm
    const deformed = deformedPositions(nodes, u, 1);
    expect(locate(deformed, elements, 1.5, 0.25)?.element).toBe(0);
  });
});
