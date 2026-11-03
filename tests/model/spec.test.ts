import { describe, expect, it } from 'vitest';
import { assembleLoads } from '../../src/core/assembly';
import { RECT_EDGE, rectangleMesh } from '../../src/mesh/structured';
import { buildModel, geometryEdgeLength } from '../../src/model/spec';
import { STEEL } from '../fixtures/meshes';

const t = 2;
// 4 × 2 mm rectangle, 4 × 2 cells: each side's edges are 1 mm long.
const mesh = rectangleMesh({ width: 4, height: 2, nx: 4, ny: 2 });

function totals(F: Float64Array): [number, number] {
  let fx = 0;
  let fy = 0;
  for (let i = 0; i < F.length; i += 2) {
    fx += F[i];
    fy += F[i + 1];
  }
  return [fx, fy];
}

describe('buildModel', () => {
  it('turns edge supports into per-node constraints', () => {
    const model = buildModel(
      {
        mesh,
        supports: [
          { edge: RECT_EDGE.left, kind: 'fixed' },
          { edge: RECT_EDGE.bottom, kind: 'roller-y' },
          { edge: RECT_EDGE.right, kind: 'roller-x' },
        ],
        loads: [],
      },
      STEEL,
      t,
    );
    const has = (node: number, direction: 'x' | 'y') =>
      model.constraints.some((c) => c.node === node && c.direction === direction);
    // Left edge nodes 0, 5, 10 fixed both ways.
    for (const n of [0, 5, 10]) expect(has(n, 'x') && has(n, 'y')).toBe(true);
    // Bottom-edge node 2 only in y; right-edge node 9 only in x.
    expect(has(2, 'y')).toBe(true);
    expect(has(2, 'x')).toBe(false);
    expect(has(9, 'x')).toBe(true);
    expect(has(9, 'y')).toBe(false);
  });

  it('spreads a total force uniformly over the edge', () => {
    const model = buildModel(
      { mesh, supports: [], loads: [{ edge: RECT_EDGE.right, kind: 'force', fx: 30, fy: -12 }] },
      STEEL,
      t,
    );
    const [fx, fy] = totals(assembleLoads(model));
    expect(fx).toBeCloseTo(30, 12);
    expect(fy).toBeCloseTo(-12, 12);
    // 30 N over 2 mm × 2 mm of edge face = 7.5 MPa.
    expect(model.tractions?.[0].tx).toBeCloseTo(7.5, 12);
  });

  it('applies pressure against the outward normal on every side', () => {
    const p = 3;
    for (const [edge, [nx, ny]] of [
      [RECT_EDGE.bottom, [0, -1]],
      [RECT_EDGE.right, [1, 0]],
      [RECT_EDGE.top, [0, 1]],
      [RECT_EDGE.left, [-1, 0]],
    ] as const) {
      const model = buildModel({ mesh, supports: [], loads: [{ edge, kind: 'pressure', p }] }, STEEL, t);
      const [fx, fy] = totals(assembleLoads(model));
      const force = p * geometryEdgeLength(mesh, edge) * t;
      expect(fx).toBeCloseTo(-force * nx, 12);
      expect(fy).toBeCloseTo(-force * ny, 12);
    }
  });

  it('gives a parabolic shear the requested total, zero at the edge ends', () => {
    const model = buildModel(
      { mesh, supports: [], loads: [{ edge: RECT_EDGE.right, kind: 'parabolic-shear', fx: 0, fy: -100 }] },
      STEEL,
      t,
    );
    const F = assembleLoads(model);
    expect(totals(F)[1]).toBeCloseTo(-100, 10);
    // Right edge nodes 4, 9, 14 (y = 0, 1, 2). By symmetry the corners carry
    // equal shares, smaller than the middle node.
    expect(F[2 * 4 + 1]).toBeCloseTo(F[2 * 14 + 1], 10);
    expect(Math.abs(F[2 * 9 + 1])).toBeGreaterThan(Math.abs(F[2 * 4 + 1]));
  });

  it('rejects loads and supports on edges that do not exist', () => {
    expect(() => buildModel({ mesh, supports: [{ edge: 9, kind: 'fixed' }], loads: [] }, STEEL, t)).toThrow(
      /geometry edge 9/,
    );
    expect(() =>
      buildModel({ mesh, supports: [], loads: [{ edge: 9, kind: 'pressure', p: 1 }] }, STEEL, t),
    ).toThrow(/geometry edge 9/);
  });
});
