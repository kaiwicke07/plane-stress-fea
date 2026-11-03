import type { Material } from './model';

/**
 * Plane-stress constitutive matrix D, so that {σx, σy, τxy} = D·{εx, εy, γxy}
 * (engineering shear strain). Returned as a 3×3 row-major array.
 * Derivation: docs/math/01-plane-stress.md.
 */
export function planeStressD(E: number, nu: number): Float64Array {
  if (!(E > 0)) throw new RangeError(`Young's modulus must be positive, got ${E}`);
  if (!(nu > -1 && nu <= 0.5)) throw new RangeError(`Poisson's ratio must be in (-1, 0.5], got ${nu}`);

  const c = E / (1 - nu * nu);
  return new Float64Array([
    c,      c * nu, 0,
    c * nu, c,      0,
    0,      0,      (c * (1 - nu)) / 2,
  ]);
}

/** Typical handbook values at room temperature. */
export const MATERIALS: readonly Material[] = [
  { name: 'Structural steel (ASTM A36)', E: 200_000, nu: 0.26, yieldStrength: 250 },
  { name: 'Aluminum 6061-T6', E: 68_900, nu: 0.33, yieldStrength: 276 },
  { name: 'Titanium Ti-6Al-4V (annealed)', E: 113_800, nu: 0.342, yieldStrength: 880 },
];
