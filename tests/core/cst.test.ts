import { describe, expect, it } from 'vitest';
import { cstB, cstStiffness, cstStress, elementB } from '../../src/core/elements/cst';
import { planeStressD } from '../../src/core/material';
import { mesh } from '../fixtures/meshes';

describe('CST element', () => {
  it('matches a hand calculation for the unit right triangle', () => {
    // Nodes (0,0), (1,0), (0,1); E = 1, ν = 0, t = 1, so D = diag(1, 1, ½) and A = ½.
    // b = (−1, 1, 0), c = (−1, 0, 1), 2A = 1, so B is just those numbers.
    const B = new Float64Array(18);
    const area = cstB(0, 0, 1, 0, 0, 1, B);
    expect(area).toBe(0.5);
    expect(Array.from(B)).toEqual([
      -1,  0, 1, 0, 0, 0,
       0, -1, 0, 0, 0, 1,
      -1, -1, 0, 1, 1, 0,
    ]);

    // kᵢⱼ = A·(B₁ᵢB₁ⱼ + B₂ᵢB₂ⱼ + ½·B₃ᵢB₃ⱼ), worked by hand.
    const ke = new Float64Array(36);
    cstStiffness(B, area, planeStressD(1, 0), 1, ke);
    const expected = [
       0.75,  0.25, -0.5,  -0.25, -0.25,  0,
       0.25,  0.75,  0,    -0.25, -0.25, -0.5,
      -0.5,   0,     0.5,   0,     0,     0,
      -0.25, -0.25,  0,     0.25,  0.25,  0,
      -0.25, -0.25,  0,     0.25,  0.25,  0,
       0,    -0.5,   0,     0,     0,     0.5,
    ];
    for (let i = 0; i < 36; i++) expect(ke[i]).toBeCloseTo(expected[i], 14);
  });

  it('has a symmetric stiffness matrix whose rows sum to zero in x and y', () => {
    const B = new Float64Array(18);
    const area = cstB(0.3, -0.2, 2.1, 0.4, 0.9, 1.7, B);
    const ke = new Float64Array(36);
    cstStiffness(B, area, planeStressD(70_000, 0.33), 2.5, ke);

    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) expect(ke[6 * i + j]).toBeCloseTo(ke[6 * j + i], 8);
      // Rigid translation (1, 0, 1, 0, 1, 0) produces no force.
      expect(ke[6 * i] + ke[6 * i + 2] + ke[6 * i + 4]).toBeCloseTo(0, 8);
      expect(ke[6 * i + 1] + ke[6 * i + 3] + ke[6 * i + 5]).toBeCloseTo(0, 8);
    }
  });

  it('reproduces the exact strain of any linear displacement field', () => {
    // u = a0 + a1·x + a2·y, v = b0 + b1·x + b2·y ⇒ ε = (a1, b2, a2 + b1) everywhere.
    const [a0, a1, a2, b0, b1, b2] = [0.1, 2e-3, -1e-3, -0.2, 4e-3, 3e-3];
    const xy = [0.3, -0.2, 2.1, 0.4, 0.9, 1.7];
    const ue = new Float64Array(6);
    for (let n = 0; n < 3; n++) {
      const [x, y] = [xy[2 * n], xy[2 * n + 1]];
      ue[2 * n] = a0 + a1 * x + a2 * y;
      ue[2 * n + 1] = b0 + b1 * x + b2 * y;
    }
    const B = new Float64Array(18);
    cstB(xy[0], xy[1], xy[2], xy[3], xy[4], xy[5], B);

    // With D = identity, the "stress" is the strain.
    const identity = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const strain = new Float64Array(3);
    cstStress(B, identity, ue, strain);
    expect(strain[0]).toBeCloseTo(a1, 14);
    expect(strain[1]).toBeCloseTo(b2, 14);
    expect(strain[2]).toBeCloseTo(a2 + b1, 14);
  });

  it('rejects clockwise and degenerate elements', () => {
    const B = new Float64Array(18);
    expect(() => elementB(mesh([0, 0, 0, 1, 1, 0], [0, 1, 2]), 0, B)).toThrow(/counter-clockwise/);
    expect(() => elementB(mesh([0, 0, 1, 1, 2, 2], [0, 1, 2]), 0, B)).toThrow(/collinear/);
  });
});
