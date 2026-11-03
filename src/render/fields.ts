// Result fields that can be plotted, at nodes (smoothed) or per element (raw).

import type { Mesh, Solution } from '../core/model';

export type FieldId = 'vonMises' | 'sx' | 'sy' | 'txy' | 'displacement';

export interface FieldDef {
  id: FieldId;
  label: string;
  unit: string;
  /** Signed quantities use a diverging map centred on zero. */
  diverging: boolean;
}

export const FIELDS: readonly FieldDef[] = [
  { id: 'vonMises', label: 'Von Mises stress σvm', unit: 'MPa', diverging: false },
  { id: 'sx', label: 'Normal stress σx', unit: 'MPa', diverging: true },
  { id: 'sy', label: 'Normal stress σy', unit: 'MPa', diverging: true },
  { id: 'txy', label: 'Shear stress τxy', unit: 'MPa', diverging: true },
  { id: 'displacement', label: 'Displacement |u|', unit: 'mm', diverging: false },
];

export function fieldById(id: FieldId): FieldDef {
  return FIELDS.find((f) => f.id === id) ?? FIELDS[0];
}

const COMPONENT = { sx: 0, sy: 1, txy: 2 } as const;

/** One value per node. Stresses are the area-weighted nodal averages. */
export function nodalValues(field: FieldId, solution: Solution): Float64Array {
  const nNodes = solution.displacements.length / 2;
  if (field === 'vonMises') return solution.nodalVonMises;
  if (field === 'displacement') return displacementMagnitude(solution.displacements);
  const c = COMPONENT[field];
  const out = new Float64Array(nNodes);
  for (let n = 0; n < nNodes; n++) out[n] = solution.nodalStress[3 * n + c];
  return out;
}

/** One value per element: the raw constant CST stress, or mean nodal |u|. */
export function elementValues(field: FieldId, solution: Solution, mesh: Mesh): Float64Array {
  const nElements = mesh.elements.length / 3;
  if (field === 'vonMises') return solution.elementVonMises;
  const out = new Float64Array(nElements);
  if (field === 'displacement') {
    const magnitude = displacementMagnitude(solution.displacements);
    for (let e = 0; e < nElements; e++) {
      out[e] =
        (magnitude[mesh.elements[3 * e]] + magnitude[mesh.elements[3 * e + 1]] + magnitude[mesh.elements[3 * e + 2]]) /
        3;
    }
    return out;
  }
  const c = COMPONENT[field];
  for (let e = 0; e < nElements; e++) out[e] = solution.elementStress[3 * e + c];
  return out;
}

/**
 * Colour range: [0, max] for magnitudes, [−m, m] for signed fields so zero
 * always sits on the neutral midpoint.
 */
export function fieldRange(values: Float64Array, diverging: boolean): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (diverging) {
    const m = Math.max(Math.abs(lo), Math.abs(hi));
    return m > 0 ? [-m, m] : [-1, 1];
  }
  return hi > 0 ? [0, hi] : [0, 1];
}

function displacementMagnitude(u: Float64Array): Float64Array {
  const out = new Float64Array(u.length / 2);
  for (let n = 0; n < out.length; n++) out[n] = Math.hypot(u[2 * n], u[2 * n + 1]);
  return out;
}
