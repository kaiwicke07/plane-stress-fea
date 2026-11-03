// Global stiffness matrix and load vector.
// Background: docs/math/03-assembly-and-boundary-conditions.md.

import { addTractionLoads } from './boundary';
import { CST_DOFS, cstStiffness, elementB } from './elements/cst';
import { type CsrMatrix, TripletList } from './linalg/sparse';
import type { Mesh, Model } from './model';

/** Writes the global DOF indices of element `e` into `dofs` (length 6). */
export function elementDofs(mesh: Mesh, e: number, dofs: Int32Array): void {
  for (let a = 0; a < 3; a++) {
    const node = mesh.elements[3 * e + a];
    dofs[2 * a] = 2 * node;
    dofs[2 * a + 1] = 2 * node + 1;
  }
}

/** K = Σₑ Lₑᵀ·kₑ·Lₑ, where Lₑ maps element DOFs to global DOFs. */
export function assembleStiffness(mesh: Mesh, D: Float64Array, thickness: number): CsrMatrix {
  const nDofs = mesh.nodes.length;
  const nElements = mesh.elements.length / 3;
  const triplets = new TripletList(nDofs, nElements * CST_DOFS * CST_DOFS);

  const B = new Float64Array(18);
  const ke = new Float64Array(CST_DOFS * CST_DOFS);
  const dofs = new Int32Array(CST_DOFS);

  for (let e = 0; e < nElements; e++) {
    const area = elementB(mesh, e, B);
    cstStiffness(B, area, D, thickness, ke);
    elementDofs(mesh, e, dofs);
    for (let a = 0; a < CST_DOFS; a++) {
      for (let b = 0; b < CST_DOFS; b++) triplets.add(dofs[a], dofs[b], ke[CST_DOFS * a + b]);
    }
  }
  return triplets.toCsr();
}

/** Global load vector F from point loads and edge tractions, N. */
export function assembleLoads(model: Model): Float64Array {
  const F = new Float64Array(model.mesh.nodes.length);
  for (const { node, fx, fy } of model.pointLoads ?? []) {
    F[2 * node] += fx;
    F[2 * node + 1] += fy;
  }
  addTractionLoads(model.mesh, model.tractions ?? [], model.thickness, F);
  return F;
}
