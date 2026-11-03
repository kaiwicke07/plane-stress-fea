import { describe, expect, it } from 'vitest';
import { delaunay } from '../../src/mesh/delaunay';

function random(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function randomPoints(n: number, seed: number): Float64Array {
  const rand = random(seed);
  return Float64Array.from({ length: 2 * n }, () => rand() * 10);
}

const orient = (p: Float64Array, a: number, b: number, c: number) =>
  (p[2 * b] - p[2 * a]) * (p[2 * c + 1] - p[2 * a + 1]) - (p[2 * b + 1] - p[2 * a + 1]) * (p[2 * c] - p[2 * a]);

/** Convex hull by Andrew's monotone chain, as point indices. */
function hull(p: Float64Array): number[] {
  const idx = Array.from({ length: p.length / 2 }, (_, i) => i).sort(
    (i, j) => p[2 * i] - p[2 * j] || p[2 * i + 1] - p[2 * j + 1],
  );
  const half = (order: number[]) => {
    const h: number[] = [];
    for (const i of order) {
      while (h.length >= 2 && orient(p, h[h.length - 2], h[h.length - 1], i) <= 0) h.pop();
      h.push(i);
    }
    h.pop();
    return h;
  };
  return [...half(idx), ...half([...idx].reverse())];
}

function polygonArea(p: Float64Array, loop: number[]): number {
  let a = 0;
  for (let k = 0; k < loop.length; k++) {
    const [i, j] = [loop[k], loop[(k + 1) % loop.length]];
    a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
  }
  return a / 2;
}

/** Every triangle counter-clockwise, and together they exactly cover the convex hull. */
function expectValidTriangulation(p: Float64Array, tris: Uint32Array) {
  let area = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a2 = orient(p, tris[t], tris[t + 1], tris[t + 2]);
    expect(a2).toBeGreaterThan(0);
    area += a2 / 2;
  }
  expect(area).toBeCloseTo(polygonArea(p, hull(p)), 8);
}

describe('delaunay', () => {
  it('triangulates random points with positive, hull-filling triangles', () => {
    const p = randomPoints(500, 3);
    const tris = delaunay(p);
    expectValidTriangulation(p, tris);
    // Euler: n points in general position, h of them on the hull, give 2n − h − 2 triangles.
    expect(tris.length / 3).toBe(2 * 500 - hull(p).length - 2);
  });

  it('satisfies the empty-circumcircle property', () => {
    const p = randomPoints(200, 11);
    const tris = delaunay(p);
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
      // Circumcentre and radius.
      const [ax, ay, bx, by, cx, cy] = [p[2 * a], p[2 * a + 1], p[2 * b], p[2 * b + 1], p[2 * c], p[2 * c + 1]];
      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
      const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
      const r = Math.hypot(ax - ux, ay - uy);
      for (let k = 0; k < p.length / 2; k++) {
        if (k === a || k === b || k === c) continue;
        expect(Math.hypot(p[2 * k] - ux, p[2 * k + 1] - uy)).toBeGreaterThan(r * (1 - 1e-9));
      }
    }
  });

  it('handles a square grid, where many points are cocircular', () => {
    const p: number[] = [];
    for (let j = 0; j <= 12; j++) for (let i = 0; i <= 15; i++) p.push(i, j);
    const points = Float64Array.from(p);
    const tris = delaunay(points);
    let area = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a2 = orient(points, tris[t], tris[t + 1], tris[t + 2]);
      expect(a2).toBeGreaterThan(0);
      area += a2 / 2;
    }
    expect(area).toBeCloseTo(15 * 12, 10);
    expect(tris.length / 3).toBe(2 * 15 * 12); // two triangles per cell
  });

  it('skips duplicate points', () => {
    const p = Float64Array.from([0, 0, 1, 0, 0, 1, 1, 1, 1, 0]);
    const tris = delaunay(p);
    expect(tris.length / 3).toBe(2);
    expect([...tris]).not.toContain(4);
  });

  it('is fast enough for re-meshing loops', () => {
    const p = randomPoints(20_000, 5);
    const t0 = performance.now();
    const tris = delaunay(p);
    const ms = performance.now() - t0;
    expect(tris.length / 3).toBe(2 * 20_000 - hull(p).length - 2);
    expect(ms).toBeLessThan(2000);
  });
});
