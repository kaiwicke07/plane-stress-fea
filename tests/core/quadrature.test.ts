import { describe, expect, it } from 'vitest';
import { tractionFieldLoads } from '../../src/core/boundary';
import { GAUSS_LINE_2, TRIANGLE_DEGREE_4 } from '../../src/core/quadrature';
import { RECT_EDGE, rectangleMesh } from '../../src/mesh/structured';
import { edgesWithTag } from '../../src/mesh/tagged-mesh';

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

describe('TRIANGLE_DEGREE_4', () => {
  it('integrates every monomial xᵃyᵇ with a + b ≤ 4 exactly', () => {
    // Reference triangle (0,0), (1,0), (0,1): ∫ xᵃyᵇ dA = a!·b! / (a + b + 2)!.
    const { points, weights } = TRIANGLE_DEGREE_4;
    for (let a = 0; a <= 4; a++) {
      for (let b = 0; a + b <= 4; b++) {
        let sum = 0;
        for (let q = 0; q < weights.length; q++) {
          const x = points[3 * q + 1]; // barycentric L2 ↔ node (1, 0)
          const y = points[3 * q + 2]; // barycentric L3 ↔ node (0, 1)
          sum += weights[q] * x ** a * y ** b;
        }
        expect(0.5 * sum).toBeCloseTo((factorial(a) * factorial(b)) / factorial(a + b + 2), 13);
      }
    }
  });

  it('has barycentric points that sum to 1', () => {
    const { points } = TRIANGLE_DEGREE_4;
    for (let q = 0; q < points.length / 3; q++) {
      expect(points[3 * q] + points[3 * q + 1] + points[3 * q + 2]).toBeCloseTo(1, 15);
    }
  });
});

describe('GAUSS_LINE_2', () => {
  it('integrates cubics on [−1, 1] exactly', () => {
    const f = (s: number) => 4 * s ** 3 - 3 * s ** 2 + 2 * s + 1; // ∫ = −2 + 2 = 0
    const sum = GAUSS_LINE_2.points.reduce((acc, s, q) => acc + GAUSS_LINE_2.weights[q] * f(s), 0);
    expect(sum).toBeCloseTo(0, 14);
  });
});

describe('tractionFieldLoads', () => {
  const t = 2;
  const m = rectangleMesh({ y0: -1, width: 1, height: 2, nx: 1, ny: 2 });
  const rightEdges = edgesWithTag(m, RECT_EDGE.right); // nodes 1 → 3 → 5 at y = −1, 0, 1

  it('reproduces the uniform-traction split for a constant field', () => {
    const loads = tractionFieldLoads(m, rightEdges, () => [3, 0], t);
    const fx = new Map(loads.map((l) => [l.node, l.fx]));
    // Each edge has length 1: 3 MPa × 1 mm × 2 mm = 6 N, half to each end.
    expect(fx.get(1)).toBeCloseTo(3, 14);
    expect(fx.get(3)).toBeCloseTo(6, 14);
    expect(fx.get(5)).toBeCloseTo(3, 14);
  });

  it('integrates a parabolic shear traction exactly', () => {
    // ty = 1 − y² on y ∈ [−1, 1]. By hand, on the edge [0, 1]:
    // ∫(1 − y)(1 − y²) dy = 5/12 to the node at y = 0, ∫ y(1 − y²) dy = 1/4 to y = 1.
    const loads = tractionFieldLoads(m, rightEdges, (_x, y) => [0, 1 - y * y], t);
    const fy = new Map(loads.map((l) => [l.node, l.fy]));
    expect(fy.get(1)).toBeCloseTo(t * 0.25, 14);
    expect(fy.get(3)).toBeCloseTo(t * (5 / 12) * 2, 14);
    expect(fy.get(5)).toBeCloseTo(t * 0.25, 14);
    // Total = t·∫(1 − y²) dy = t·4/3.
    expect(loads.reduce((s, l) => s + l.fy, 0)).toBeCloseTo((t * 4) / 3, 14);
  });
});
