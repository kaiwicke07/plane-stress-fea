// Stress recovery: element stresses, von Mises, and nodal averaging for plots.
// Background: docs/math/05-stress-recovery.md.

import { elementDofs } from './assembly';
import { CST_DOFS, cstStress, elementB } from './elements/cst';
import type { Mesh } from './model';

/** Element stresses [σx, σy, τxy] and areas from nodal displacements u. */
export function elementStresses(
  mesh: Mesh,
  D: Float64Array,
  u: Float64Array,
): { stress: Float64Array; area: Float64Array } {
  const nElements = mesh.elements.length / 3;
  const stress = new Float64Array(3 * nElements);
  const area = new Float64Array(nElements);
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
 * σₙ = Σ Aₑ·σₑ / Σ Aₑ.
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
  for (let node = 0; node < nNodes; node++) {
    if (weight[node] > 0) for (let c = 0; c < 3; c++) sum[3 * node + c] /= weight[node];
  }
  return sum;
}

/**
 * Superconvergent patch recovery (Zienkiewicz–Zhu). For each interior node,
 * fit σ*(x, y) = a + b·x + c·y by least squares to the centroid stresses of
 * the elements around it (the CST's most accurate sampling points), and take
 * σ* at the node. Boundary nodes average σ* from the patches of interior nodes
 * they belong to, which extrapolates the gradient to the surface instead of
 * averaging from one side. Falls back to nodal averaging where no patch fits.
 */
export function sprNodalStress(mesh: Mesh, elementStress: Float64Array, elementArea: Float64Array): Float64Array {
  const { nodes, elements } = mesh;
  const nNodes = nodes.length / 2;
  const nElements = elements.length / 3;
  const fallback = nodalAverage(mesh, elementStress, elementArea);

  // Node → elements adjacency, in CSR form.
  const start = new Int32Array(nNodes + 1);
  for (const n of elements) start[n + 1]++;
  for (let n = 0; n < nNodes; n++) start[n + 1] += start[n];
  const adjacent = new Int32Array(elements.length);
  const fill = start.slice(0, nNodes);
  for (let e = 0; e < nElements; e++) for (let a = 0; a < 3; a++) adjacent[fill[elements[3 * e + a]]++] = e;

  const onBoundary = boundaryNodes(mesh);
  const centroid = new Float64Array(2 * nElements);
  for (let e = 0; e < nElements; e++) {
    for (let a = 0; a < 3; a++) {
      centroid[2 * e] += nodes[2 * elements[3 * e + a]] / 3;
      centroid[2 * e + 1] += nodes[2 * elements[3 * e + a] + 1] / 3;
    }
  }

  // 1. Fit a linear field on the patch of every interior node.
  const result = fallback.slice();
  const fitted = new Uint8Array(nNodes);
  const coeffs = new Float64Array(9 * nNodes); // [a, b, c] per stress component, per node
  const scales = new Float64Array(nNodes);
  const A = new Float64Array(9);
  const rhs = new Float64Array(9);

  for (let n = 0; n < nNodes; n++) {
    if (onBoundary[n]) continue;
    const [xn, yn] = [nodes[2 * n], nodes[2 * n + 1]];
    const patch = adjacent.subarray(start[n], start[n + 1]);
    if (patch.length < 3) continue;

    // Local, scaled coordinates keep the 3×3 normal equations well conditioned.
    let scale = 0;
    for (const e of patch) scale = Math.max(scale, Math.hypot(centroid[2 * e] - xn, centroid[2 * e + 1] - yn));
    if (scale === 0) continue;

    // Normal equations (Σ P·Pᵀ)·coeffs = Σ P·σₑ with P = [1, ξ, η].
    A.fill(0);
    rhs.fill(0);
    for (const e of patch) {
      const P = [1, (centroid[2 * e] - xn) / scale, (centroid[2 * e + 1] - yn) / scale];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) A[3 * i + j] += P[i] * P[j];
        for (let c = 0; c < 3; c++) rhs[3 * c + i] += P[i] * elementStress[3 * e + c];
      }
    }
    if (!solve3x3(A, rhs, coeffs.subarray(9 * n, 9 * n + 9))) continue;
    fitted[n] = 1;
    scales[n] = scale;
    result[3 * n] = coeffs[9 * n];
    result[3 * n + 1] = coeffs[9 * n + 3];
    result[3 * n + 2] = coeffs[9 * n + 6];
  }

  const neighbours = (n: number) => {
    const set = new Set<number>();
    for (const e of adjacent.subarray(start[n], start[n + 1])) for (let a = 0; a < 3; a++) set.add(elements[3 * e + a]);
    set.delete(n);
    return set;
  };

  // 2. Boundary nodes: mean of the fits of adjacent interior nodes, extrapolated
  // to the boundary node. A node no interior patch reaches (a corner whose only
  // element has all its nodes on the boundary) uses the next ring out.
  for (let m = 0; m < nNodes; m++) {
    if (!onBoundary[m]) continue;
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
      const xi = (nodes[2 * m] - nodes[2 * n]) / scales[n];
      const eta = (nodes[2 * m + 1] - nodes[2 * n + 1]) / scales[n];
      for (let c = 0; c < 3; c++) sum[c] += coeffs[9 * n + 3 * c] + coeffs[9 * n + 3 * c + 1] * xi + coeffs[9 * n + 3 * c + 2] * eta;
    }
    for (let c = 0; c < 3; c++) result[3 * m + c] = sum[c] / donors.length;
  }
  return result;
}

/** Nodes on an edge used by exactly one element. */
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
 * Solves the symmetric 3×3 system A·x = b for three right-hand sides at once
 * (b and x hold [rhs₀, rhs₁, rhs₂] per component, 3 values each), by Cramer's
 * rule. Returns false if A is (nearly) singular, e.g. collinear centroids.
 */
function solve3x3(A: Float64Array, b: Float64Array, x: Float64Array): boolean {
  const [a, b1, c, d, e, f, g, h, i] = A;
  const det = a * (e * i - f * h) - b1 * (d * i - f * g) + c * (d * h - e * g);
  const trace = a + e + i;
  if (!(Math.abs(det) > 1e-12 * trace ** 3)) return false;
  // Inverse via the adjugate.
  const inv = [
    e * i - f * h,
    c * h - b1 * i,
    b1 * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b1 * g - a * h,
    a * e - b1 * d,
  ].map((v) => v / det);
  for (let k = 0; k < 3; k++) {
    for (let r = 0; r < 3; r++) {
      x[3 * k + r] = inv[3 * r] * b[3 * k] + inv[3 * r + 1] * b[3 * k + 1] + inv[3 * r + 2] * b[3 * k + 2];
    }
  }
  return true;
}
