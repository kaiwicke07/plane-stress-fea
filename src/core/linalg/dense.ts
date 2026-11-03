// Dense Cholesky solver. O(n³), so it is the reference solver for tests and
// tiny models; real models use PCG. Background: docs/math/04-linear-solvers.md.

import { NotPositiveDefiniteError } from './errors';

/**
 * Relative pivot threshold. A pivot this small compared with the original
 * diagonal entry means the column is (numerically) a combination of earlier
 * ones, i.e. the matrix is singular.
 */
const PIVOT_TOLERANCE = 1e-10;

/**
 * Solves A·x = b for symmetric positive-definite A (n×n, row-major) by
 * factoring A = L·Lᵀ. Throws NotPositiveDefiniteError if a pivot is not
 * safely positive.
 */
export function choleskySolve(A: Float64Array, b: Float64Array): Float64Array {
  const n = b.length;
  if (A.length !== n * n) throw new RangeError(`Matrix is ${A.length} entries, expected ${n}×${n}`);

  // L is lower triangular, stored in the lower half of a dense array.
  const L = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    let pivot = A[j * n + j];
    for (let k = 0; k < j; k++) pivot -= L[j * n + k] ** 2;
    if (!(pivot > PIVOT_TOLERANCE * Math.abs(A[j * n + j]))) {
      throw new NotPositiveDefiniteError(`Cholesky pivot ${pivot} at row ${j} is not positive`);
    }
    const Ljj = Math.sqrt(pivot);
    L[j * n + j] = Ljj;

    for (let i = j + 1; i < n; i++) {
      let sum = A[i * n + j];
      for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
      L[i * n + j] = sum / Ljj;
    }
  }

  // Forward substitution: L·y = b.
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i * n + k] * y[k];
    y[i] = sum / L[i * n + i];
  }

  // Back substitution: Lᵀ·x = y.
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k * n + i] * x[k];
    x[i] = sum / L[i * n + i];
  }
  return x;
}
