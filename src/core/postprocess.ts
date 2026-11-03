// Stress recovery: element stresses, von Mises, and nodal values for plots.
// Background: docs/math/05-stress-recovery.md, 08-meshing.md (SPR),
// 10-lst-element.md (6-node elements).

import { elementDofs } from './assembly';
import { CST_DOFS, cstStress, elementB } from './elements/cst';
import { LST_DOFS, LST_GAUSS, LST_NODE_XI, lstB, lstCoords, lstPoint, lstStress } from './elements/lst';
import type { Mesh } from './model';

/**
 * Element stresses [σx, σy, τxy] and areas from nodal displacements u. CST
 * stress is constant; for LST this is the stress at the centroid.
 */
export function elementStresses(
  mesh: Mesh,
  D: Float64Array,
  u: Float64Array,
): { stress: Float64Array; area: Float64Array } {
  const nElements = mesh.elements.length / 3;
  const stress = new Float64Array(3 * nElements);
  const area = new Float64Array(nElements);

  if (mesh.midNodes) {
    const nodes = new Int32Array(6);
    const coords = new Float64Array(12);
    const ue = new Float64Array(LST_DOFS);
    const B = new Float64Array(36);
    for (let e = 0; e < nElements; e++) {
      lstCoords(mesh, e, nodes, coords);
      gather(u, nodes, ue);
      for (const [xi, eta] of LST_GAUSS.points) area[e] += LST_GAUSS.weight * lstB(coords, xi, eta, B, e);
      lstStress(coords, D, ue, 1 / 3, 1 / 3, stress, 3 * e, e);
    }
    return { stress, area };
  }

  const B = new Float64Array(18);
  const dofs = new Int32Array(CST_DOFS);
  const ue = new Float64Array(CST_DOFS);
  for (let e = 0; e < nElements; e++) {
    area[e] = elementB(mesh, e, B);
    elementDofs(mesh, e, dofs);
    for (let a = 0; a < CST_DOFS; a++) ue[a] = u[dofs[a]];
    cstStress(B, D, ue, stress, 3 * e);
  }
  return { stress, area };
}

/** Plane-stress von Mises stress: √(σx² − σx·σy + σy² + 3τxy²). */
export function vonMises(sx: number, sy: number, txy: number): number {
  return Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * txy * txy);
}

/** Von Mises stress for each [σx, σy, τxy] triple in `stress`. */
export function vonMisesField(stress: Float64Array): Float64Array {
  const out = new Float64Array(stress.length / 3);
  for (let i = 0; i < out.length; i++) out[i] = vonMises(stress[3 * i], stress[3 * i + 1], stress[3 * i + 2]);
  return out;
}

/**
 * Nodal stress as the area-weighted average of the elements around each node:
 * σₙ = Σ Aₑ·σₑ / Σ Aₑ. For a CST the element value is its constant stress.
 */
export function nodalAverage(mesh: Mesh, elementStress: Float64Array, elementArea: Float64Array): Float64Array {
  const nNodes = mesh.nodes.length / 2;
  const sum = new Float64Array(3 * nNodes);
  const weight = new Float64Array(nNodes);
  const { elements } = mesh;

  for (let e = 0; e < elementArea.length; e++) {
    const A = elementArea[e];
    for (let a = 0; a < 3; a++) {
      const node = elements[3 * e + a];
      weight[node] += A;
      for (let c = 0; c < 3; c++) sum[3 * node + c] += A * elementStress[3 * e + c];
    }
  }
  return divide(sum, weight);
}

/**
 * LST nodal stress: each element's own (linear) stress field evaluated at
 * each of its six nodes, then area-weighted averaged across elements. Unlike a
 * CST centroid value, this is not biased at a surface.
 */
export function nodalAverageLst(mesh: Mesh, D: Float64Array, u: Float64Array, elementArea: Float64Array): Float64Array {
  const nNodes = mesh.nodes.length / 2;
  const sum = new Float64Array(3 * nNodes);
  const weight = new Float64Array(nNodes);
  const nodes = new Int32Array(6);
  const coords = new Float64Array(12);
  const ue = new Float64Array(LST_DOFS);
  const s = new Float64Array(3);
  for (let e = 0; e < elementArea.length; e++) {
    lstCoords(mesh, e, nodes, coords);
    gather(u, nodes, ue);
    const A = elementArea[e];
    LST_NODE_XI.forEach(([xi, eta], a) => {
      lstStress(coords, D, ue, xi, eta, s, 0, e);
      weight[nodes[a]] += A;
      for (let c = 0; c < 3; c++) sum[3 * nodes[a] + c] += A * s[c];
    });
  }
  return divide(sum, weight);
}

/** Stress samples for patch recovery: `perElement` points per element. */
interface Samples {
  perElement: number;
  /** Sample coordinates [x, y, …]. */
  points: Float64Array;
  /** Sample stresses [σx, σy, τxy, …]. */
  stress: Float64Array;
}

/**
 * Superconvergent patch recovery (Zienkiewicz–Zhu) for CST. Fits
 * σ*(x, y) = a + b·x + c·y to the centroid stresses of the elements around
 * each interior node (the CST's most accurate sampling points).
 */
export function sprNodalStress(mesh: Mesh, elementStress: Float64Array, elementArea: Float64Array): Float64Array {
  const { nodes, elements } = mesh;
  const nElements = elements.length / 3;
  const points = new Float64Array(2 * nElements);
  for (let e = 0; e < nElements; e++) {
    for (let a = 0; a < 3; a++) {
      points[2 * e] += nodes[2 * elements[3 * e + a]] / 3;
      points[2 * e + 1] += nodes[2 * elements[3 * e + a] + 1] / 3;
    }
  }
  return patchRecovery(mesh, { perElement: 1, points, stress: elementStress }, 1, nodalAverage(mesh, elementStress, elementArea));
}

/**
 * SPR for LST: a quadratic σ*(x, y) fitted to the stresses at the three Gauss
 * points of each element in the patch, the LST's most accurate sampling points.
 */
export function sprNodalStressLst(mesh: Mesh, D: Float64Array, u: Float64Array, fallback: Float64Array): Float64Array {
  const nElements = mesh.elements.length / 3;
  const per = LST_GAUSS.points.length;
  const points = new Float64Array(2 * per * nElements);
  const stress = new Float64Array(3 * per * nElements);
  const nodes = new Int32Array(6);
  const coords = new Float64Array(12);
  const ue = new Float64Array(LST_DOFS);
  for (let e = 0; e < nElements; e++) {
    lstCoords(mesh, e, nodes, coords);
    gather(u, nodes, ue);
    LST_GAUSS.points.forEach(([xi, eta], q) => {
      const k = per * e + q;
      points.set(lstPoint(coords, xi, eta), 2 * k);
      lstStress(coords, D, ue, xi, eta, stress, 3 * k, e);
    });
  }
  return patchRecovery(mesh, { perElement: per, points, stress }, 2, fallback);
}

/**
 * Patch recovery with a polynomial of `degree` 1 or 2. Patches are assembled
 * at interior corner nodes, which take the fit's value at themselves. Every
 * other node (boundary corners, all mid-side nodes) averages the fits of the
 * neighbouring assembly nodes evaluated at it, which extrapolates the gradient
 * to the surface. A node no patch reaches, such as a corner whose only element
 * lies entirely on the boundary, uses the next ring out. Anything left
 * unreached keeps `fallback`.
 */
function patchRecovery(mesh: Mesh, samples: Samples, degree: 1 | 2, fallback: Float64Array): Float64Array {
  const { nodes, elements } = mesh;
  const nNodes = nodes.length / 2;
  const nElements = elements.length / 3;
  const terms = degree === 1 ? 3 : 6;

  // Node → elements, over all element nodes (corners and mid-side).
  const elementNodes = (e: number): number[] => {
    const corners = [elements[3 * e], elements[3 * e + 1], elements[3 * e + 2]];
    const mids = mesh.midNodes;
    return mids ? [...corners, mids[3 * e], mids[3 * e + 1], mids[3 * e + 2]] : corners;
  };
  const adjacent: number[][] = Array.from({ length: nNodes }, () => []);
  for (let e = 0; e < nElements; e++) for (const n of elementNodes(e)) adjacent[n].push(e);

  const onBoundary = boundaryNodes(mesh);
  const isCorner = new Uint8Array(nNodes);
  for (const n of elements) isCorner[n] = 1;

  // 1. Fit at every interior corner node.
  const result = fallback.slice();
  const fitted = new Uint8Array(nNodes);
  const coeffs = new Float64Array(3 * terms * nNodes); // per node: terms coefficients per stress component
  const scales = new Float64Array(nNodes);
  const basis = new Float64Array(terms);
  const A = new Float64Array(terms * terms);
  const rhs = new Float64Array(3 * terms);

  for (let n = 0; n < nNodes; n++) {
    if (!isCorner[n] || onBoundary[n]) continue;
    const patch = adjacent[n];
    if (patch.length * samples.perElement < terms) continue;
    const [xn, yn] = [nodes[2 * n], nodes[2 * n + 1]];

    // Local, scaled coordinates keep the normal equations well conditioned.
    let scale = 0;
    for (const e of patch) {
      for (let q = 0; q < samples.perElement; q++) {
        const k = samples.perElement * e + q;
        scale = Math.max(scale, Math.hypot(samples.points[2 * k] - xn, samples.points[2 * k + 1] - yn));
      }
    }
    if (scale === 0) continue;

    // Normal equations (Σ P·Pᵀ)·c = Σ P·σ.
    A.fill(0);
    rhs.fill(0);
    for (const e of patch) {
      for (let q = 0; q < samples.perElement; q++) {
        const k = samples.perElement * e + q;
        evalBasis((samples.points[2 * k] - xn) / scale, (samples.points[2 * k + 1] - yn) / scale, degree, basis);
        for (let i = 0; i < terms; i++) {
          for (let j = 0; j < terms; j++) A[terms * i + j] += basis[i] * basis[j];
          for (let c = 0; c < 3; c++) rhs[terms * c + i] += basis[i] * samples.stress[3 * k + c];
        }
      }
    }
    if (!solveNormalEquations(A, rhs, terms, coeffs.subarray(3 * terms * n, 3 * terms * (n + 1)))) continue;
    fitted[n] = 1;
    scales[n] = scale;
    for (let c = 0; c < 3; c++) result[3 * n + c] = coeffs[3 * terms * n + terms * c]; // value at the node itself
  }

  // 2. Every other node: mean of neighbouring fits, evaluated at the node.
  const neighbours = (n: number) => {
    const set = new Set<number>();
    for (const e of adjacent[n]) for (const k of elementNodes(e)) set.add(k);
    set.delete(n);
    return set;
  };
  for (let m = 0; m < nNodes; m++) {
    if (fitted[m] || adjacent[m].length === 0) continue;
    const ring1 = neighbours(m);
    let donors = [...ring1].filter((n) => fitted[n]);
    if (donors.length === 0) {
      const ring2 = new Set<number>();
      for (const k of ring1) for (const n of neighbours(k)) if (n !== m && fitted[n]) ring2.add(n);
      donors = [...ring2];
    }
    if (donors.length === 0) continue;
    const sum = [0, 0, 0];
    for (const n of donors) {
      evalBasis((nodes[2 * m] - nodes[2 * n]) / scales[n], (nodes[2 * m + 1] - nodes[2 * n + 1]) / scales[n], degree, basis);
      for (let c = 0; c < 3; c++) {
        for (let i = 0; i < terms; i++) sum[c] += coeffs[3 * terms * n + terms * c + i] * basis[i];
      }
    }
    for (let c = 0; c < 3; c++) result[3 * m + c] = sum[c] / donors.length;
  }
  return result;
}

function evalBasis(xi: number, eta: number, degree: 1 | 2, out: Float64Array): void {
  out[0] = 1;
  out[1] = xi;
  out[2] = eta;
  if (degree === 2) {
    out[3] = xi * xi;
    out[4] = xi * eta;
    out[5] = eta * eta;
  }
}

/** Corner nodes on an edge used by exactly one element. */
export function boundaryNodes({ nodes, elements }: Mesh): Uint8Array {
  const nNodes = nodes.length / 2;
  const count = new Map<number, number>();
  const key = (a: number, b: number) => Math.min(a, b) * nNodes + Math.max(a, b);
  for (let t = 0; t < elements.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const id = key(elements[t + k], elements[t + ((k + 1) % 3)]);
      count.set(id, (count.get(id) ?? 0) + 1);
    }
  }
  const out = new Uint8Array(nNodes);
  for (const [id, c] of count) {
    if (c !== 1) continue;
    out[Math.floor(id / nNodes)] = 1;
    out[id % nNodes] = 1;
  }
  return out;
}

/**
 * Solves the symmetric m×m system A·x = b for three right-hand sides (b and x
 * hold m values per stress component) by Gaussian elimination with partial
 * pivoting. Returns false if A is (nearly) singular, e.g. collinear samples.
 */
function solveNormalEquations(A: Float64Array, b: Float64Array, m: number, x: Float64Array): boolean {
  const M = A.slice();
  const R = b.slice();
  let scale = 0;
  for (let i = 0; i < m; i++) scale = Math.max(scale, Math.abs(M[m * i + i]));
  for (let col = 0; col < m; col++) {
    let pivot = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(M[m * r + col]) > Math.abs(M[m * pivot + col])) pivot = r;
    if (!(Math.abs(M[m * pivot + col]) > 1e-12 * scale)) return false;
    if (pivot !== col) {
      for (let j = 0; j < m; j++) [M[m * col + j], M[m * pivot + j]] = [M[m * pivot + j], M[m * col + j]];
      for (let c = 0; c < 3; c++) [R[m * c + col], R[m * c + pivot]] = [R[m * c + pivot], R[m * c + col]];
    }
    for (let r = col + 1; r < m; r++) {
      const f = M[m * r + col] / M[m * col + col];
      for (let j = col; j < m; j++) M[m * r + j] -= f * M[m * col + j];
      for (let c = 0; c < 3; c++) R[m * c + r] -= f * R[m * c + col];
    }
  }
  for (let c = 0; c < 3; c++) {
    for (let r = m - 1; r >= 0; r--) {
      let s = R[m * c + r];
      for (let j = r + 1; j < m; j++) s -= M[m * r + j] * x[m * c + j];
      x[m * c + r] = s / M[m * r + r];
    }
  }
  return true;
}

function gather(u: Float64Array, nodes: Int32Array, ue: Float64Array): void {
  for (let a = 0; a < nodes.length; a++) {
    ue[2 * a] = u[2 * nodes[a]];
    ue[2 * a + 1] = u[2 * nodes[a] + 1];
  }
}

function divide(sum: Float64Array, weight: Float64Array): Float64Array {
  for (let n = 0; n < weight.length; n++) {
    if (weight[n] > 0) for (let c = 0; c < 3; c++) sum[3 * n + c] /= weight[n];
  }
  return sum;
}
