// Loads and boundary conditions: traction → nodal forces, partitioning DOFs
// into free and prescribed, and reducing K·u = F to the free DOFs.
// Background: docs/math/03-assembly-and-boundary-conditions.md.

import { choleskySolve } from './linalg/dense';
import { NotPositiveDefiniteError } from './linalg/errors';
import type { CsrMatrix } from './linalg/sparse';
import { type Constraint, dofIndex, type EdgeTraction, type Mesh, type PointLoad } from './model';
import { GAUSS_LINE_2 } from './quadrature';

/**
 * Adds consistent nodal forces for uniform edge tractions to F. For a linear
 * edge and constant traction, f = ∫ Nᵀ·t̄ · t ds puts half of the edge's total
 * force on each end node.
 */
export function addTractionLoads(
  mesh: Mesh,
  tractions: readonly EdgeTraction[],
  thickness: number,
  F: Float64Array,
): void {
  if (tractions.length === 0) return;
  const edges = meshEdges(mesh);
  const { nodes } = mesh;

  for (const { nodes: [a, b], tx, ty } of tractions) {
    if (!edges.has(edgeKey(a, b))) throw new Error(`Traction edge (${a}, ${b}) is not an element edge`);
    const length = Math.hypot(nodes[2 * b] - nodes[2 * a], nodes[2 * b + 1] - nodes[2 * a + 1]);
    const half = (length * thickness) / 2;
    F[2 * a] += tx * half;
    F[2 * a + 1] += ty * half;
    F[2 * b] += tx * half;
    F[2 * b + 1] += ty * half;
  }
}

/**
 * Consistent nodal forces f = ∫ Nᵀ·t̄(x, y) · t ds for a traction that varies
 * along the edges, integrated with 2-point Gauss quadrature. This is exact when
 * the traction is at most quadratic along each edge.
 *
 * Returns point loads because a Model must be serialisable (it is sent to a Web
 * Worker), so it cannot carry the traction function itself.
 */
export function tractionFieldLoads(
  mesh: Mesh,
  edges: readonly (readonly [number, number])[],
  traction: (x: number, y: number) => readonly [number, number],
  thickness: number,
): PointLoad[] {
  const { nodes } = mesh;
  const forces = new Map<number, [number, number]>();
  const add = (node: number, fx: number, fy: number) => {
    const f = forces.get(node) ?? [0, 0];
    f[0] += fx;
    f[1] += fy;
    forces.set(node, f);
  };

  for (const [a, b] of edges) {
    const [xa, ya, xb, yb] = [nodes[2 * a], nodes[2 * a + 1], nodes[2 * b], nodes[2 * b + 1]];
    const jacobian = Math.hypot(xb - xa, yb - ya) / 2; // ds = (L/2) dξ
    for (let q = 0; q < GAUSS_LINE_2.points.length; q++) {
      const xi = GAUSS_LINE_2.points[q];
      const Na = (1 - xi) / 2;
      const Nb = (1 + xi) / 2;
      const [tx, ty] = traction(Na * xa + Nb * xb, Na * ya + Nb * yb);
      const w = GAUSS_LINE_2.weights[q] * jacobian * thickness;
      add(a, w * Na * tx, w * Na * ty);
      add(b, w * Nb * tx, w * Nb * ty);
    }
  }
  return [...forces].map(([node, [fx, fy]]) => ({ node, fx, fy }));
}

export interface DofPartition {
  /** Index of each global DOF in the reduced (free) system, or -1 if prescribed. */
  freeIndex: Int32Array;
  /** Global DOF of each reduced-system unknown. */
  freeDofs: Int32Array;
  /** Prescribed displacement of each global DOF, 0 at free DOFs. */
  prescribed: Float64Array;
}

export function partitionDofs(nNodes: number, constraints: readonly Constraint[]): DofPartition {
  const nDofs = 2 * nNodes;
  const isPrescribed = new Uint8Array(nDofs);
  const prescribed = new Float64Array(nDofs);

  for (const { node, direction, value = 0 } of constraints) {
    if (!(Number.isInteger(node) && node >= 0 && node < nNodes)) {
      throw new RangeError(`Constraint on node ${node}, but the mesh has ${nNodes} nodes`);
    }
    const dof = dofIndex(node, direction);
    if (isPrescribed[dof] && prescribed[dof] !== value) {
      throw new Error(`Node ${node} has conflicting ${direction} constraints (${prescribed[dof]} and ${value})`);
    }
    isPrescribed[dof] = 1;
    prescribed[dof] = value;
  }

  const freeIndex = new Int32Array(nDofs);
  const freeDofs: number[] = [];
  for (let dof = 0; dof < nDofs; dof++) {
    if (isPrescribed[dof]) {
      freeIndex[dof] = -1;
    } else {
      freeIndex[dof] = freeDofs.length;
      freeDofs.push(dof);
    }
  }
  return { freeIndex, freeDofs: Int32Array.from(freeDofs), prescribed };
}

/**
 * Throws if the constraints allow a rigid-body motion of the whole part.
 * Each constrained DOF gives one row of C, the value of the three rigid-body
 * modes (x translation, y translation, rotation) at that DOF. The supports
 * prevent every rigid motion exactly when C has rank 3, i.e. CᵀC is positive
 * definite.
 */
export function checkRigidBodyRestraint(mesh: Mesh, constraints: readonly Constraint[]): void {
  const { nodes } = mesh;
  const hasX = constraints.some((c) => c.direction === 'x');
  const hasY = constraints.some((c) => c.direction === 'y');
  if (!hasX || !hasY) {
    throw new Error(`Supports allow rigid-body translation in ${hasX ? 'y' : 'x'}; constrain at least one node in ${hasX ? 'y' : 'x'}`);
  }

  // Rotate about the centroid of the constrained nodes, and scale the rotation
  // mode by their spread, so the three columns of C have comparable size.
  let cx = 0;
  let cy = 0;
  for (const { node } of constraints) {
    cx += nodes[2 * node];
    cy += nodes[2 * node + 1];
  }
  cx /= constraints.length;
  cy /= constraints.length;
  let scale = 0;
  for (const { node } of constraints) {
    scale = Math.max(scale, Math.hypot(nodes[2 * node] - cx, nodes[2 * node + 1] - cy));
  }

  const G = new Float64Array(9); // CᵀC
  const row = new Float64Array(3);
  for (const { node, direction } of constraints) {
    const x = scale > 0 ? (nodes[2 * node] - cx) / scale : 0;
    const y = scale > 0 ? (nodes[2 * node + 1] - cy) / scale : 0;
    // Rigid displacement field: u = a − θ·y, v = b + θ·x.
    if (direction === 'x') row.set([1, 0, -y]);
    else row.set([0, 1, x]);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) G[3 * i + j] += row[i] * row[j];
  }

  try {
    choleskySolve(G, new Float64Array(3));
  } catch (error) {
    if (!(error instanceof NotPositiveDefiniteError)) throw error;
    throw new Error(
      'Supports allow rigid-body rotation; constrain a second node, or the same direction at two separated points',
      { cause: error },
    );
  }
}

/**
 * Reduces K·u = F to K_ff·u_f = F_f − K_fc·u_c, where f are free DOFs and c are
 * prescribed DOFs with known displacements u_c.
 */
export function reduceSystem(
  K: CsrMatrix,
  F: Float64Array,
  { freeIndex, freeDofs, prescribed }: DofPartition,
): { Kff: CsrMatrix; rhs: Float64Array } {
  const nFree = freeDofs.length;
  const rowPtr = new Int32Array(nFree + 1);
  const colIdx: number[] = [];
  const values: number[] = [];
  const rhs = new Float64Array(nFree);

  for (let fi = 0; fi < nFree; fi++) {
    const i = freeDofs[fi];
    rhs[fi] = F[i];
    for (let k = K.rowPtr[i]; k < K.rowPtr[i + 1]; k++) {
      const j = K.colIdx[k];
      const fj = freeIndex[j];
      if (fj >= 0) {
        // freeIndex is increasing in j, so columns stay sorted.
        colIdx.push(fj);
        values.push(K.values[k]);
      } else {
        rhs[fi] -= K.values[k] * prescribed[j];
      }
    }
    rowPtr[fi + 1] = colIdx.length;
  }

  return {
    Kff: { n: nFree, rowPtr, colIdx: Int32Array.from(colIdx), values: Float64Array.from(values) },
    rhs,
  };
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function meshEdges(mesh: Mesh): Set<string> {
  const edges = new Set<string>();
  const { elements } = mesh;
  for (let e = 0; e < elements.length; e += 3) {
    edges.add(edgeKey(elements[e], elements[e + 1]));
    edges.add(edgeKey(elements[e + 1], elements[e + 2]));
    edges.add(edgeKey(elements[e + 2], elements[e]));
  }
  return edges;
}
