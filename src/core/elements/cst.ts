// Constant strain triangle (CST): 3 nodes, linear displacement, constant strain.
// Derivation: docs/math/02-cst-element.md.
//
// Element DOF order is [u1, v1, u2, v2, u3, v3]. Matrices are row-major.

import type { Mesh } from '../model';

export const CST_DOFS = 6;

/**
 * Writes the 3×6 strain-displacement matrix B of a triangle into `B`, so that
 * {εx, εy, γxy} = B·uₑ. Returns the signed area, which is positive when the
 * nodes are counter-clockwise.
 */
export function cstB(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  B: Float64Array,
): number {
  const twoA = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);

  // ∂Nᵢ/∂x = bᵢ / 2A and ∂Nᵢ/∂y = cᵢ / 2A for the linear shape functions Nᵢ.
  const s = 1 / twoA;
  const b1 = (y2 - y3) * s;
  const b2 = (y3 - y1) * s;
  const b3 = (y1 - y2) * s;
  const c1 = (x3 - x2) * s;
  const c2 = (x1 - x3) * s;
  const c3 = (x2 - x1) * s;

  B.fill(0);
  // εx = ∂u/∂x
  B[0] = b1;
  B[2] = b2;
  B[4] = b3;
  // εy = ∂v/∂y
  B[7] = c1;
  B[9] = c2;
  B[11] = c3;
  // γxy = ∂u/∂y + ∂v/∂x
  B[12] = c1;
  B[13] = b1;
  B[14] = c2;
  B[15] = b2;
  B[16] = c3;
  B[17] = b3;

  return twoA / 2;
}

/**
 * Computes B for element `e` of a mesh and returns its area. Throws if the
 * element is clockwise or degenerate.
 */
export function elementB(mesh: Mesh, e: number, B: Float64Array): number {
  const { nodes, elements } = mesh;
  const n1 = elements[3 * e];
  const n2 = elements[3 * e + 1];
  const n3 = elements[3 * e + 2];
  const area = cstB(
    nodes[2 * n1],
    nodes[2 * n1 + 1],
    nodes[2 * n2],
    nodes[2 * n2 + 1],
    nodes[2 * n3],
    nodes[2 * n3 + 1],
    B,
  );
  if (!(area > 0)) {
    throw new Error(
      `Element ${e} (nodes ${n1}, ${n2}, ${n3}) has area ${area}; ` +
        'nodes must be counter-clockwise and not collinear',
    );
  }
  return area;
}

// Scratch for D·B, reused across calls. The solver is single-threaded.
const DB = new Float64Array(18);

/** Writes the 6×6 element stiffness kₑ = t·A·Bᵀ·D·B into `ke`. */
export function cstStiffness(
  B: Float64Array,
  area: number,
  D: Float64Array,
  thickness: number,
  ke: Float64Array,
): void {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 6; j++) {
      DB[6 * i + j] = D[3 * i] * B[j] + D[3 * i + 1] * B[6 + j] + D[3 * i + 2] * B[12 + j];
    }
  }
  const tA = thickness * area;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      ke[6 * i + j] = tA * (B[i] * DB[j] + B[6 + i] * DB[6 + j] + B[12 + i] * DB[12 + j]);
    }
  }
}

/** Writes the element stress {σx, σy, τxy} = D·B·uₑ into `out` at `offset`. */
export function cstStress(
  B: Float64Array,
  D: Float64Array,
  ue: Float64Array,
  out: Float64Array,
  offset = 0,
): void {
  let ex = 0;
  let ey = 0;
  let gxy = 0;
  for (let j = 0; j < 6; j++) {
    ex += B[j] * ue[j];
    ey += B[6 + j] * ue[j];
    gxy += B[12 + j] * ue[j];
  }
  out[offset] = D[0] * ex + D[1] * ey + D[2] * gxy;
  out[offset + 1] = D[3] * ex + D[4] * ey + D[5] * gxy;
  out[offset + 2] = D[6] * ex + D[7] * ey + D[8] * gxy;
}
