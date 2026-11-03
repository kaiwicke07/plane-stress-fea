// Linear strain triangle (LST): 6 nodes, quadratic displacement, linear strain.
// Isoparametric, so edges may be curved (mid-side nodes off the chord).
// Derivation: docs/math/10-lst-element.md.
//
// Node order: corners 1, 2, 3 counter-clockwise, then mid-side 4 (on 1–2),
// 5 (on 2–3), 6 (on 3–1). Element DOFs are [u1, v1, …, u6, v6].
// Natural coordinates (ξ, η) on the reference triangle (0,0), (1,0), (0,1):
// area coordinates L1 = 1 − ξ − η, L2 = ξ, L3 = η.

import type { Mesh } from '../model';

export const LST_DOFS = 12;

/** Natural coordinates of the six nodes. */
export const LST_NODE_XI: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [0.5, 0],
  [0.5, 0.5],
  [0, 0.5],
];

/**
 * 3-point rule on the reference triangle (area ½), exact for quadratics, so
 * exact for the straight-sided LST stiffness, whose integrand BᵀDB is quadratic.
 * These points are also where LST stress is most accurate.
 */
export const LST_GAUSS = {
  points: [
    [1 / 6, 1 / 6],
    [2 / 3, 1 / 6],
    [1 / 6, 2 / 3],
  ] as const,
  weight: 1 / 6,
};

/** Shape functions N and their ξ, η derivatives at (ξ, η). */
export function lstShape(xi: number, eta: number, N: Float64Array, dXi: Float64Array, dEta: Float64Array): void {
  const L1 = 1 - xi - eta;
  const [L2, L3] = [xi, eta];
  N[0] = L1 * (2 * L1 - 1);
  N[1] = L2 * (2 * L2 - 1);
  N[2] = L3 * (2 * L3 - 1);
  N[3] = 4 * L1 * L2;
  N[4] = 4 * L2 * L3;
  N[5] = 4 * L3 * L1;
  // ∂L1/∂ξ = ∂L1/∂η = −1, ∂L2/∂ξ = 1, ∂L3/∂η = 1.
  dXi[0] = 1 - 4 * L1;
  dXi[1] = 4 * L2 - 1;
  dXi[2] = 0;
  dXi[3] = 4 * (L1 - L2);
  dXi[4] = 4 * L3;
  dXi[5] = -4 * L3;
  dEta[0] = 1 - 4 * L1;
  dEta[1] = 0;
  dEta[2] = 4 * L3 - 1;
  dEta[3] = -4 * L2;
  dEta[4] = 4 * L2;
  dEta[5] = 4 * (L1 - L3);
}

/** The element's six node indices, corners first, into `out`. */
export function lstNodes(mesh: Mesh, e: number, out: Int32Array): void {
  const mids = mesh.midNodes;
  if (!mids) throw new Error('LST needs a mesh with mid-side nodes');
  for (let a = 0; a < 3; a++) {
    out[a] = mesh.elements[3 * e + a];
    out[3 + a] = mids[3 * e + a];
  }
}

/** Node coordinates [x1, y1, …, x6, y6] of element `e`. */
export function lstCoords(mesh: Mesh, e: number, nodes: Int32Array, coords: Float64Array): void {
  lstNodes(mesh, e, nodes);
  for (let a = 0; a < 6; a++) {
    coords[2 * a] = mesh.nodes[2 * nodes[a]];
    coords[2 * a + 1] = mesh.nodes[2 * nodes[a] + 1];
  }
}

const N = new Float64Array(6);
const dXi = new Float64Array(6);
const dEta = new Float64Array(6);

/**
 * Writes the 3×12 strain-displacement matrix at (ξ, η) into `B` and returns
 * det J, the local area scale (2A for a straight-sided element). Throws if
 * det J ≤ 0: an inverted or badly curved element.
 */
export function lstB(coords: Float64Array, xi: number, eta: number, B: Float64Array, e = -1): number {
  lstShape(xi, eta, N, dXi, dEta);
  // J = [∂x/∂ξ ∂y/∂ξ; ∂x/∂η ∂y/∂η]
  let [j11, j12, j21, j22] = [0, 0, 0, 0];
  for (let a = 0; a < 6; a++) {
    j11 += dXi[a] * coords[2 * a];
    j12 += dXi[a] * coords[2 * a + 1];
    j21 += dEta[a] * coords[2 * a];
    j22 += dEta[a] * coords[2 * a + 1];
  }
  const det = j11 * j22 - j12 * j21;
  if (!(det > 0)) throw new Error(`Element ${e} has a non-positive Jacobian (${det}); it is inverted or too distorted`);

  B.fill(0);
  for (let a = 0; a < 6; a++) {
    // [∂N/∂x; ∂N/∂y] = J⁻¹ [∂N/∂ξ; ∂N/∂η]
    const dx = (j22 * dXi[a] - j12 * dEta[a]) / det;
    const dy = (-j21 * dXi[a] + j11 * dEta[a]) / det;
    B[2 * a] = dx; // εx = ∂u/∂x
    B[12 + 2 * a + 1] = dy; // εy = ∂v/∂y
    B[24 + 2 * a] = dy; // γxy = ∂u/∂y + ∂v/∂x
    B[24 + 2 * a + 1] = dx;
  }
  return det;
}

// Scratch, reused across calls. The solver is single-threaded.
const Bq = new Float64Array(36);
const DB = new Float64Array(36);

/** kₑ = t ∫ BᵀDB dA by 3-point quadrature; returns the element area. */
export function lstStiffness(coords: Float64Array, D: Float64Array, thickness: number, ke: Float64Array, e = -1): number {
  ke.fill(0);
  let area = 0;
  for (const [xi, eta] of LST_GAUSS.points) {
    const det = lstB(coords, xi, eta, Bq, e);
    const w = LST_GAUSS.weight * det;
    area += w;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 12; j++) {
        DB[12 * i + j] = D[3 * i] * Bq[j] + D[3 * i + 1] * Bq[12 + j] + D[3 * i + 2] * Bq[24 + j];
      }
    }
    const f = thickness * w;
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        ke[12 * i + j] += f * (Bq[i] * DB[j] + Bq[12 + i] * DB[12 + j] + Bq[24 + i] * DB[24 + j]);
      }
    }
  }
  return area;
}

/** Stress {σx, σy, τxy} = D·B(ξ, η)·uₑ, written into `out` at `offset`. */
export function lstStress(
  coords: Float64Array,
  D: Float64Array,
  ue: Float64Array,
  xi: number,
  eta: number,
  out: Float64Array,
  offset = 0,
  e = -1,
): void {
  lstB(coords, xi, eta, Bq, e);
  let [ex, ey, gxy] = [0, 0, 0];
  for (let j = 0; j < 12; j++) {
    ex += Bq[j] * ue[j];
    ey += Bq[12 + j] * ue[j];
    gxy += Bq[24 + j] * ue[j];
  }
  out[offset] = D[0] * ex + D[1] * ey + D[2] * gxy;
  out[offset + 1] = D[3] * ex + D[4] * ey + D[5] * gxy;
  out[offset + 2] = D[6] * ex + D[7] * ey + D[8] * gxy;
}

/** Physical point (x, y) at natural coordinates (ξ, η). */
export function lstPoint(coords: Float64Array, xi: number, eta: number): [number, number] {
  lstShape(xi, eta, N, dXi, dEta);
  let [x, y] = [0, 0];
  for (let a = 0; a < 6; a++) {
    x += N[a] * coords[2 * a];
    y += N[a] * coords[2 * a + 1];
  }
  return [x, y];
}
