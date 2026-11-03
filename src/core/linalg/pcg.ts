// Jacobi-preconditioned conjugate gradient for symmetric positive-definite
// sparse systems. Background: docs/math/04-linear-solvers.md.

import { NotPositiveDefiniteError } from './errors';
import { type CsrMatrix, csrDiagonal, csrMatVec } from './sparse';

export interface PcgOptions {
  /** Stop when ‖b − A·x‖ / ‖b‖ falls below this. */
  tolerance?: number;
  maxIterations?: number;
}

export interface PcgResult {
  x: Float64Array;
  iterations: number;
  relativeResidual: number;
}

export function pcg(A: CsrMatrix, b: Float64Array, options: PcgOptions = {}): PcgResult {
  const n = A.n;
  const tolerance = options.tolerance ?? 1e-10;
  const maxIterations = options.maxIterations ?? 5 * n + 100;

  // Jacobi preconditioner M = diag(A); store M⁻¹. Checked before the b = 0
  // shortcut so a DOF with no stiffness is reported even without loads.
  const invDiag = csrDiagonal(A);
  for (let i = 0; i < n; i++) {
    if (!(invDiag[i] > 0)) {
      throw new NotPositiveDefiniteError(`Diagonal entry ${i} is ${invDiag[i]}, not positive`);
    }
    invDiag[i] = 1 / invDiag[i];
  }

  const x = new Float64Array(n);
  const bNorm = Math.sqrt(dot(b, b));
  if (bNorm === 0) return { x, iterations: 0, relativeResidual: 0 };

  const r = b.slice(); // r = b − A·x with x = 0
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = invDiag[i] * r[i];
  const p = z.slice();
  const Ap = new Float64Array(n);
  let rz = dot(r, z);
  let relativeResidual = 1;

  for (let iter = 1; iter <= maxIterations; iter++) {
    csrMatVec(A, p, Ap);
    const pAp = dot(p, Ap);
    // For SPD A, pᵀAp > 0 for every p ≠ 0. Otherwise there is a zero-energy mode.
    if (!(pAp > 0)) {
      throw new NotPositiveDefiniteError(`Search direction has non-positive energy pᵀAp = ${pAp}`);
    }

    const alpha = rz / pAp;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }

    relativeResidual = Math.sqrt(dot(r, r)) / bNorm;
    if (relativeResidual < tolerance) return { x, iterations: iter, relativeResidual };

    for (let i = 0; i < n; i++) z[i] = invDiag[i] * r[i];
    const rzNext = dot(r, z);
    const beta = rzNext / rz;
    rz = rzNext;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }

  throw new Error(
    `PCG did not converge in ${maxIterations} iterations (relative residual ${relativeResidual.toExponential(2)})`,
  );
}

function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
