// Checks the exact cantilever solution itself, independently of the FE code:
// it must satisfy equilibrium, Hooke's law with strains from its own
// displacements, and the boundary conditions it claims.

import { describe, expect, it } from 'vitest';
import { cantileverEndTraction, cantileverExact, eulerBernoulliTip, timoshenkoTip } from '../../src/validation/analytical';
import { DEFAULT_CANTILEVER } from '../../src/validation/cases';

const params = DEFAULT_CANTILEVER;
const { length: L, depth, thickness, load: P } = params;
const { E, nu } = params.material;
const c = depth / 2;
const exact = cantileverExact(params);
const d = 1e-4; // central-difference step, mm

/** Sample points inside the beam. */
const samples = [
  [10, -7],
  [37, 3],
  [61, 9.5],
  [88, -2],
];

describe('exact cantilever solution', () => {
  it('satisfies equilibrium: ∂σx/∂x + ∂τxy/∂y = 0 and ∂τxy/∂x + ∂σy/∂y = 0', () => {
    for (const [x, y] of samples) {
      const dsx_dx = (exact.stress(x + d, y)[0] - exact.stress(x - d, y)[0]) / (2 * d);
      const dtxy_dy = (exact.stress(x, y + d)[2] - exact.stress(x, y - d)[2]) / (2 * d);
      const dtxy_dx = (exact.stress(x + d, y)[2] - exact.stress(x - d, y)[2]) / (2 * d);
      const dsy_dy = (exact.stress(x, y + d)[1] - exact.stress(x, y - d)[1]) / (2 * d);
      expect(dsx_dx + dtxy_dy).toBeCloseTo(0, 6);
      expect(dtxy_dx + dsy_dy).toBeCloseTo(0, 6);
    }
  });

  it("has displacements whose strains obey Hooke's law with its stresses", () => {
    for (const [x, y] of samples) {
      const du_dx = (exact.displacement(x + d, y)[0] - exact.displacement(x - d, y)[0]) / (2 * d);
      const du_dy = (exact.displacement(x, y + d)[0] - exact.displacement(x, y - d)[0]) / (2 * d);
      const dv_dx = (exact.displacement(x + d, y)[1] - exact.displacement(x - d, y)[1]) / (2 * d);
      const dv_dy = (exact.displacement(x, y + d)[1] - exact.displacement(x, y - d)[1]) / (2 * d);
      const [sx, sy, txy] = exact.stress(x, y);
      // Strains here are ~1e-4; require agreement to better than 1e-9.
      expect(du_dx - (sx - nu * sy) / E).toBeCloseTo(0, 9);
      expect(dv_dy - (sy - nu * sx) / E).toBeCloseTo(0, 9);
      expect(du_dy + dv_dx - (2 * (1 + nu) * txy) / E).toBeCloseTo(0, 9);
    }
  });

  it('has traction-free top and bottom faces and a stress-free axial end', () => {
    for (const x of [0, 25, 50, 99]) {
      for (const y of [-c, c]) {
        const [, sy, txy] = exact.stress(x, y);
        expect(sy).toBeCloseTo(0, 12);
        expect(txy).toBeCloseTo(0, 12);
      }
    }
    for (const y of [-c, -3, 0, 6, c]) expect(exact.stress(L, y)[0]).toBeCloseTo(0, 12);
  });

  it('carries a total end shear of P downward', () => {
    // Simpson's rule is exact for the quadratic traction.
    const ty = cantileverEndTraction(params);
    const total = (thickness * depth * (ty(L, -c)[1] + 4 * ty(L, 0)[1] + ty(L, c)[1])) / 6;
    expect(total).toBeCloseTo(-P, 10);
  });

  it('is fixed at the wall centre with a horizontal neutral axis', () => {
    const [u, v] = exact.displacement(0, 0);
    expect(u).toBeCloseTo(0, 15);
    expect(v).toBeCloseTo(0, 15);
    const slope = (exact.displacement(d, 0)[1] - exact.displacement(-d, 0)[1]) / (2 * d);
    expect(slope).toBeCloseTo(0, 10);
  });

  it('gives the Euler–Bernoulli tip deflection on the neutral axis', () => {
    expect(-exact.displacement(L, 0)[1]).toBeCloseTo(eulerBernoulliTip(params), 12);
    expect(eulerBernoulliTip(params)).toBeCloseTo(0.5, 12); // 1000·100³ / (3·200 000·3333.3)
    expect(timoshenkoTip(params)).toBeGreaterThan(eulerBernoulliTip(params));
  });
});
