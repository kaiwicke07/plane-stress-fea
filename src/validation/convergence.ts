// Error norms against an exact solution, and observed convergence rates.
// Background: docs/math/06-cantilever-validation.md.

import type { Material, Mesh, Solution } from '../core/model';
import { TRIANGLE_DEGREE_4 } from '../core/quadrature';
import type { ExactField } from './analytical';

export interface ErrorNorms {
  /** ‖u − uₕ‖_L2 / ‖u‖_L2. Expected to converge as O(h²) for CST. */
  displacementL2: number;
  /** Energy norm ‖u − uₕ‖_E / ‖u‖_E. Expected to converge as O(h) for CST. */
  energy: number;
}

/**
 * Relative error norms of an FE solution, integrated element by element with a
 * degree-4 rule. uₕ is interpolated with the element shape functions; σₕ is the
 * constant element stress.
 */
export function errorNorms(mesh: Mesh, solution: Solution, exact: ExactField, material: Material): ErrorNorms {
  const { nodes, elements } = mesh;
  const { displacements: u, elementStress } = solution;
  const { E, nu } = material;
  const { points, weights } = TRIANGLE_DEGREE_4;

  // Complementary energy density σᵀ·C·σ with the plane-stress compliance C = D⁻¹.
  const energyDensity = (sx: number, sy: number, txy: number) =>
    (sx * sx - 2 * nu * sx * sy + sy * sy + 2 * (1 + nu) * txy * txy) / E;

  let l2Error = 0;
  let l2Exact = 0;
  let energyError = 0;
  let energyExact = 0;

  for (let e = 0; e < elements.length / 3; e++) {
    const n = [elements[3 * e], elements[3 * e + 1], elements[3 * e + 2]];
    const x = n.map((k) => nodes[2 * k]);
    const y = n.map((k) => nodes[2 * k + 1]);
    const area = ((x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0])) / 2;
    const [sxh, syh, txyh] = [elementStress[3 * e], elementStress[3 * e + 1], elementStress[3 * e + 2]];

    for (let q = 0; q < weights.length; q++) {
      const L = [points[3 * q], points[3 * q + 1], points[3 * q + 2]];
      const xq = L[0] * x[0] + L[1] * x[1] + L[2] * x[2];
      const yq = L[0] * y[0] + L[1] * y[1] + L[2] * y[2];
      const uh = L[0] * u[2 * n[0]] + L[1] * u[2 * n[1]] + L[2] * u[2 * n[2]];
      const vh = L[0] * u[2 * n[0] + 1] + L[1] * u[2 * n[1] + 1] + L[2] * u[2 * n[2] + 1];
      const [ue, ve] = exact.displacement(xq, yq);
      const [sx, sy, txy] = exact.stress(xq, yq);
      const w = weights[q] * area;

      l2Error += w * ((ue - uh) ** 2 + (ve - vh) ** 2);
      l2Exact += w * (ue * ue + ve * ve);
      energyError += w * energyDensity(sx - sxh, sy - syh, txy - txyh);
      energyExact += w * energyDensity(sx, sy, txy);
    }
  }

  return {
    displacementL2: Math.sqrt(l2Error / l2Exact),
    energy: Math.sqrt(energyError / energyExact),
  };
}

/**
 * Richardson extrapolation: if q(h) ≈ q* + C·hᵖ, two solutions at h and h/2
 * give q* ≈ q_fine + (q_fine − q_coarse) / (2ᵖ − 1).
 */
export function richardson(coarse: number, fine: number, order: number): number {
  return fine + (fine - coarse) / (2 ** order - 1);
}

/**
 * Observed order of convergence between successive refinements: if e ≈ C·hᵖ,
 * then p = log(e₁/e₂) / log(h₁/h₂). Returns one rate per pair of levels.
 */
export function observedRates(h: readonly number[], error: readonly number[]): number[] {
  const rates: number[] = [];
  for (let k = 1; k < h.length; k++) rates.push(Math.log(error[k - 1] / error[k]) / Math.log(h[k - 1] / h[k]));
  return rates;
}
