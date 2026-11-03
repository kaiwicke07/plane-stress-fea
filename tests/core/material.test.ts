import { describe, expect, it } from 'vitest';
import { planeStressD } from '../../src/core/material';

function apply(D: Float64Array, strain: number[]): number[] {
  return [0, 1, 2].map((i) => D[3 * i] * strain[0] + D[3 * i + 1] * strain[1] + D[3 * i + 2] * strain[2]);
}

describe('planeStressD', () => {
  const E = 200_000;
  const nu = 0.3;
  const D = planeStressD(E, nu);

  it('matches the closed form', () => {
    const c = E / (1 - nu * nu);
    expect(Array.from(D)).toEqual([c, c * nu, 0, c * nu, c, 0, 0, 0, (c * (1 - nu)) / 2]);
  });

  it('is symmetric', () => {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(D[3 * i + j]).toBe(D[3 * j + i]);
  });

  it('recovers uniaxial stress from the uniaxial strain state', () => {
    // σx = σ, σy = 0 gives εx = σ/E and εy = −νσ/E (Poisson contraction).
    const sigma = 100;
    const [sx, sy, txy] = apply(D, [sigma / E, (-nu * sigma) / E, 0]);
    expect(sx).toBeCloseTo(sigma, 10);
    expect(sy).toBeCloseTo(0, 10);
    expect(txy).toBe(0);
  });

  it('gives τ = G·γ with G = E / 2(1 + ν)', () => {
    const gamma = 1e-3;
    const G = E / (2 * (1 + nu));
    expect(apply(D, [0, 0, gamma])[2]).toBeCloseTo(G * gamma, 10);
  });

  it('rejects non-physical properties', () => {
    expect(() => planeStressD(0, 0.3)).toThrow(RangeError);
    expect(() => planeStressD(E, 0.6)).toThrow(RangeError);
    expect(() => planeStressD(E, -1)).toThrow(RangeError);
  });
});
