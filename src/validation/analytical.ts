// Closed-form reference solutions. Derivations: docs/math/06-cantilever-validation.md.

import type { Material } from '../core/model';

export interface CantileverParams {
  /** Span L from wall (x = 0) to free end (x = L), mm. */
  length: number;
  /** Depth h = 2c, with y measured from the neutral axis (−c ≤ y ≤ c), mm. */
  depth: number;
  thickness: number;
  /** Total downward end load P, N. */
  load: number;
  material: Material;
}

export interface ExactField {
  displacement(x: number, y: number): [number, number];
  stress(x: number, y: number): [number, number, number];
}

/**
 * Exact plane-stress solution for a cantilever loaded by a parabolic shear
 * traction on its free end (Timoshenko & Goodier, §21), in our coordinates.
 * The rigid-body constants are fixed by u = v = ∂v/∂x = 0 at the wall centre
 * (0, 0); the FE model reproduces them by prescribing this field on the wall.
 */
export function cantileverExact({ length: L, depth, thickness, load: P, material }: CantileverParams): ExactField {
  const { E, nu } = material;
  const c = depth / 2;
  const I = (thickness * depth ** 3) / 12;
  const G = E / (2 * (1 + nu));

  return {
    stress(x, y) {
      return [(P * (L - x) * y) / I, 0, (-P * (c * c - y * y)) / (2 * I)];
    },
    displacement(x, y) {
      const u =
        (P * y * (L * x - (x * x) / 2)) / (E * I) -
        (nu * P * y ** 3) / (6 * E * I) +
        (P * y ** 3) / (6 * G * I) -
        (P * c * c * y) / (2 * G * I);
      const v = (-nu * P * (L - x) * y * y) / (2 * E * I) - (P * ((L * x * x) / 2 - x ** 3 / 6)) / (E * I);
      return [u, v];
    },
  };
}

/** End shear traction on the free face x = L: t = (0, τxy), MPa. */
export function cantileverEndTraction({ depth, thickness, load: P }: CantileverParams) {
  const c = depth / 2;
  const I = (thickness * depth ** 3) / 12;
  return (_x: number, y: number): [number, number] => [0, (-P * (c * c - y * y)) / (2 * I)];
}

/** Euler–Bernoulli tip deflection PL³/3EI, positive downward. */
export function eulerBernoulliTip({ length: L, depth, thickness, load: P, material }: CantileverParams): number {
  const I = (thickness * depth ** 3) / 12;
  return (P * L ** 3) / (3 * material.E * I);
}

/** Timoshenko beam tip deflection PL³/3EI + PL/κGA with κ = 5/6, positive downward. */
export function timoshenkoTip(params: CantileverParams): number {
  const { length: L, depth, thickness, load: P, material } = params;
  const G = material.E / (2 * (1 + material.nu));
  return eulerBernoulliTip(params) + (P * L) / ((5 / 6) * G * depth * thickness);
}

// ── Plate with a central hole under uniaxial tension ───────────────────────
//
// Plate width W (across the load), hole diameter d = 2a, load along x.
//   σ_gross = P / (W·t)            far-field stress (the applied traction)
//   σ_net   = P / ((W − d)·t)      mean stress on the net section through the hole
//   K_t,g = σ_max / σ_gross,  K_t,n = σ_max / σ_net,  K_t,g = K_t,n · W / (W − d)
// See docs/PLAN.md and docs/math/08-meshing.md.

/** Which reference stress a stress concentration factor is normalised by. */
export type StressBasis = 'gross' | 'net';

export interface StressConcentration {
  basis: StressBasis;
  value: number;
}

/** Label generated from the basis, so a gross value can never be shown as net. */
export function ktLabel(basis: StressBasis): string {
  return basis === 'gross' ? 'K_t,g (gross section)' : 'K_t,n (net section)';
}

/** Kirsch: infinite plate, so K_t,g = 3 at the hole edge. */
export const KIRSCH_KT: StressConcentration = { basis: 'gross', value: 3 };

/**
 * Kirsch's σxx along the net-section line x = 0, y ≥ a, divided by σ_gross:
 * σθ(r, 90°)/σ = 1 + ½(a/r)² + (3/2)(a/r)⁴. Infinite plate only.
 */
export function kirschLigament(a: number, y: number): number {
  const s = (a / y) ** 2;
  return 1 + s / 2 + (3 * s * s) / 2;
}

/** Heywood's empirical fit for a finite-width plate: K_t,n ≈ 2 + (1 − d/W)³. */
export function heywoodKt(dOverW: number): StressConcentration {
  return { basis: 'net', value: 2 + (1 - dOverW) ** 3 };
}

/** Converts a stress concentration factor to the other basis. */
export function convertKt(kt: StressConcentration, to: StressBasis, dOverW: number): StressConcentration {
  if (kt.basis === to) return kt;
  // σ_net = σ_gross / (1 − d/W)
  return { basis: to, value: to === 'gross' ? kt.value / (1 - dOverW) : kt.value * (1 - dOverW) };
}
