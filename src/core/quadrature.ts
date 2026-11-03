// Numerical integration rules. Background: docs/math/06-cantilever-validation.md.

/** 2-point Gauss–Legendre rule on [−1, 1]. Exact for polynomials up to degree 3. */
export const GAUSS_LINE_2 = {
  points: [-1 / Math.sqrt(3), 1 / Math.sqrt(3)],
  weights: [1, 1],
} as const;

/**
 * 6-point rule on a triangle, exact for polynomials up to degree 4 (Dunavant).
 * Points are barycentric coordinates (L1, L2, L3); weights sum to 1, so
 * ∫ f dA ≈ A · Σ wₖ f(pₖ).
 */
export const TRIANGLE_DEGREE_4 = (() => {
  const a = 0.445948490915965;
  const b = 0.091576213509771;
  const wa = 0.223381589678011;
  const wb = 0.109951743655322;
  const points = [
    a, a, 1 - 2 * a,   a, 1 - 2 * a, a,   1 - 2 * a, a, a,
    b, b, 1 - 2 * b,   b, 1 - 2 * b, b,   1 - 2 * b, b, b,
  ];
  return {
    points: Float64Array.from(points),
    weights: Float64Array.from([wa, wa, wa, wb, wb, wb]),
  };
})();
