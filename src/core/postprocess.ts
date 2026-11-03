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
