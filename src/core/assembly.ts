// Global stiffness matrix and load vector.
// Background: docs/math/03-assembly-and-boundary-conditions.md.

import { addTractionLoads } from './boundary';
import { CST_DOFS, cstStiffness, elementB } from './elements/cst';
import { LST_DOFS, lstCoords, lstStiffness } from './elements/lst';
import { type CsrMatrix, TripletList } from './linalg/sparse';
import type { Mesh, Model } from './model';

/** Writes the global DOF indices of CST element `e` into `dofs` (length 6). */
export function elementDofs(mesh: Mesh, e: number, dofs: Int32Array): void {
  for (let a = 0; a < 3; a++) {
    const node = mesh.elements[3 * e + a];
    dofs[2 * a] = 2 * node;
    dofs[2 * a + 1] = 2 * node + 1;
  }
}

/**
 * K = Σₑ Lₑᵀ·kₑ·Lₑ, where Lₑ maps element DOFs to global DOFs. Uses 6-node
 * LST elements when the mesh has mid-side nodes, 3-node CST otherwise.
 */
export function assembleStiffness(mesh: Mesh, D: Float64Array, thickness: number): CsrMatrix {
  const nDofs = mesh.nodes.length;
  const nElements = mesh.elements.length / 3;
  const size = mesh.midNodes ? LST_DOFS : CST_DOFS;
  const triplets = new TripletList(nDofs, nElements * size * size);
  const ke = new Float64Array(size * size);
  const dofs = new Int32Array(size);
  const add = () => {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < size; b++) triplets.add(dofs[a], dofs[b], ke[size * a + b]);
    }
  };

  if (mesh.midNodes) {
    const nodes = new Int32Array(6);
    const coords = new Float64Array(12);
    for (let e = 0; e < nElements; e++) {
      lstCoords(mesh, e, nodes, coords);
      lstStiffness(coords, D, thickness, ke, e);
      for (let a = 0; a < 6; a++) {
        dofs[2 * a] = 2 * nodes[a];
        dofs[2 * a + 1] = 2 * nodes[a] + 1;
      }
      add();
    }
    return triplets.toCsr();
  }

  const B = new Float64Array(18);
  for (let e = 0; e < nElements; e++) {
    const area = elementB(mesh, e, B);
    cstStiffness(B, area, D, thickness, ke);
    elementDofs(mesh, e, dofs);
    add();
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
