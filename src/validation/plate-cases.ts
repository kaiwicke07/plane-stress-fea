// Plate with a central hole under uniaxial tension, modelled as a quarter with
// symmetry rollers. Used by the test suite and the site's validation page.

import { MATERIALS } from '../core/material';
import type { Material, Solution } from '../core/model';
import { solve } from '../core/solve';
import { distmesh } from '../mesh/distmesh';
import { distanceToHoles, type Region } from '../mesh/geometry';
import { meshQuality } from '../mesh/quality';
import type { TaggedMesh } from '../mesh/tagged-mesh';
import { buildModel, type StudySetup } from '../model/spec';
import {
  convertKt,
  heywoodKt,
  KIRSCH_KT,
  kirschLigament,
  type StressBasis,
  type StressConcentration,
} from './analytical';

export interface PlateParams {
  /** Full plate width W, across the load (y), mm. */
  width: number;
  /** Full plate length L, along the load (x), mm. */
  length: number;
  /** Hole diameter d, mm. */
  holeDiameter: number;
  thickness: number;
  /** Applied far-field stress σ_gross, MPa. */
  stress: number;
  material: Material;
}

export interface PlateMeshOptions {
  /** Element size at the hole edge, mm. */
  hHole: number;
  /** Largest element size, mm. */
  hMax: number;
  /** Size growth per mm of distance from the hole. */
  grading: number;
}

/** Geometry edge IDs of the quarter model. */
export const PLATE_EDGE = { bottom: 0, right: 1, top: 2, left: 3, hole: 4 } as const;

/** Wide plate for the Kirsch comparison: W/d = 10, L = 2W. */
export const KIRSCH_PLATE: PlateParams = {
  width: 100,
  length: 200,
  holeDiameter: 10,
  thickness: 5,
  stress: 100,
  material: MATERIALS[0],
};

/** Quarter plate [0, L/2] × [0, W/2] minus the quarter hole at the origin. */
export function plateRegion({ width, length, holeDiameter }: PlateParams): Region {
  const [x, y] = [length / 2, width / 2];
  return {
    outer: {
      kind: 'polygon',
      points: [
        [0, 0],
        [x, 0],
        [x, y],
        [0, y],
      ],
    },
    holes: [{ kind: 'circle', cx: 0, cy: 0, r: holeDiameter / 2 }],
  };
}

/** Mesh, symmetry rollers and the far-field traction for the quarter model. */
export function plateSetup(params: PlateParams, mesh: PlateMeshOptions): StudySetup & { converged: boolean } {
  const region = plateRegion(params);
  const { hHole, hMax, grading } = mesh;
  const result = distmesh(region, {
    hMin: hHole,
    size: (x, y) => Math.min(hMax, hHole + grading * distanceToHoles(region, x, y)),
  });
  return {
    mesh: result.mesh,
    converged: result.converged,
    supports: [
      { edge: PLATE_EDGE.left, kind: 'roller-x' }, // symmetry about x = 0
      { edge: PLATE_EDGE.bottom, kind: 'roller-y' }, // symmetry about y = 0
    ],
    loads: [{ edge: PLATE_EDGE.right, kind: 'traction', tx: params.stress, ty: 0 }],
  };
}

/**
 * How the peak stress was obtained:
 * - 'average': area-weighted nodal average at the peak node (one-sided at a boundary)
 * - 'spr': superconvergent patch recovery at the peak node
 * - 'element': largest constant stress of the elements touching the peak node
 * - 'spr-arc-fit': least-squares fit of the SPR hoop stress along the hole edge
 *   near the peak, σθθ ≈ A + B·cos 2φ (the form of Kirsch's solution), peak = A + B
 */
export type Recovery = 'average' | 'spr' | 'element' | 'spr-arc-fit';

export const RECOVERY_LABEL: Record<Recovery, string> = {
  average: 'nodal average',
  spr: 'SPR, peak node',
  element: 'element (centroid)',
  'spr-arc-fit': 'SPR, fitted along hole edge',
};

/** Angular half-window of the hole-edge fit, measured from the peak at θ = 90°. */
const ARC_FIT_WINDOW = (30 * Math.PI) / 180;

export interface PlateRun {
  dOverW: number;
  hHole: number;
  dofs: number;
  elements: number;
  minAngle: number;
  meshConverged: boolean;
  /** Peak σxx at the hole edge on the net section, (0, a), by recovery method, MPa. */
  peakStress: Record<Recovery, number>;
  /** FE stress concentration factors, each with an explicit basis and recovery method. */
  kt: Record<Recovery, Record<StressBasis, StressConcentration>>;
  /** σxx / σ_gross along the net section x = 0, from the hole edge outward. */
  ligament: { y: number; average: number; spr: number; kirsch: number }[];
}

export function runPlate(params: PlateParams, meshOptions: PlateMeshOptions): PlateRun {
  const setup = plateSetup(params, meshOptions);
  const model = buildModel(setup, params.material, params.thickness);
  const solution = solve(model);
  const { mesh } = setup;
  const a = params.holeDiameter / 2;
  const dOverW = params.holeDiameter / params.width;

  const peakNode = nearestNode(mesh, 0, a);
  const peakStress: Record<Recovery, number> = {
    average: solution.nodalStress[3 * peakNode],
    spr: solution.sprStress[3 * peakNode],
    element: maxElementSxxAt(mesh, solution, peakNode),
    'spr-arc-fit': hoopStressPeak(mesh, solution.sprStress, a),
  };
  const kt = Object.fromEntries(
    (Object.keys(peakStress) as Recovery[]).map((r) => {
      const gross: StressConcentration = { basis: 'gross', value: peakStress[r] / params.stress };
      return [r, { gross, net: convertKt(gross, 'net', dOverW) }];
    }),
  ) as PlateRun['kt'];

  const ligament: PlateRun['ligament'] = [];
  for (let n = 0; n < mesh.nodes.length / 2; n++) {
    const [x, y] = [mesh.nodes[2 * n], mesh.nodes[2 * n + 1]];
    if (Math.abs(x) > 1e-9 || y < a - 1e-9) continue;
    ligament.push({
      y,
      average: solution.nodalStress[3 * n] / params.stress,
      spr: solution.sprStress[3 * n] / params.stress,
      kirsch: kirschLigament(a, y),
    });
  }
  ligament.sort((p, q) => p.y - q.y);

  return {
    dOverW,
    hHole: meshOptions.hHole,
    dofs: mesh.nodes.length,
    elements: mesh.elements.length / 3,
    minAngle: meshQuality(mesh).minAngle,
    meshConverged: setup.converged,
    peakStress,
    kt,
    ligament,
  };
}

/** References for a plate, each on its own basis. */
export function plateReferences(dOverW: number) {
  const heywoodNet = heywoodKt(dOverW);
  return {
    /** Infinite plate; only comparable on the gross basis, for small d/W. */
    kirsch: KIRSCH_KT,
    heywood: heywoodNet,
    /** Heywood converted to gross, labelled as converted wherever shown. */
    heywoodAsGross: convertKt(heywoodNet, 'gross', dOverW),
  };
}

/**
 * Self-similar graded mesh: h(x) = (a/k)·(1 + 2·dist/a), capped at 30a/k.
 * Doubling k halves the element size everywhere, which is what a refinement
 * study needs. Refining only at the hole edge would leave the surrounding
 * stress-gradient zone coarse, and the peak would not converge.
 */
export function holeMesh(params: PlateParams, elementsPerRadius: number): PlateMeshOptions {
  const a = params.holeDiameter / 2;
  const hHole = a / elementsPerRadius;
  return { hHole, hMax: 30 * hHole, grading: 2 / elementsPerRadius };
}

/**
 * Peak hoop stress at θ = 90° from a least-squares fit of σθθ ≈ A + B·cos 2φ,
 * φ = 90° − θ, to the nodes on the hole edge within ARC_FIT_WINDOW of the peak.
 * Using many nodes removes the scatter of reading one node of an unstructured
 * mesh; at θ = 90°, σθθ is the load-direction stress σxx.
 */
export function hoopStressPeak(mesh: TaggedMesh, stress: Float64Array, a: number): number {
  // Normal equations for [A, B] with basis [1, c], c = cos 2φ.
  let [n, sc, scc, s, sCs] = [0, 0, 0, 0, 0];
  for (let k = 0; k < mesh.nodes.length / 2; k++) {
    const [x, y] = [mesh.nodes[2 * k], mesh.nodes[2 * k + 1]];
    if (Math.abs(Math.hypot(x, y) - a) > 1e-6 * a) continue;
    const theta = Math.atan2(y, x);
    if (Math.PI / 2 - theta > ARC_FIT_WINDOW) continue;
    const [sx, sy, txy] = [stress[3 * k], stress[3 * k + 1], stress[3 * k + 2]];
    const [sin, cos] = [Math.sin(theta), Math.cos(theta)];
    const hoop = sx * sin * sin + sy * cos * cos - 2 * txy * sin * cos;
    const c = Math.cos(2 * (Math.PI / 2 - theta));
    n++;
    sc += c;
    scc += c * c;
    s += hoop;
    sCs += c * hoop;
  }
  const det = n * scc - sc * sc;
  if (n < 3 || det <= 0) return NaN;
  const A = (s * scc - sc * sCs) / det;
  const B = (n * sCs - sc * s) / det;
  return A + B;
}

function nearestNode(mesh: TaggedMesh, x: number, y: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let n = 0; n < mesh.nodes.length / 2; n++) {
    const d = Math.hypot(mesh.nodes[2 * n] - x, mesh.nodes[2 * n + 1] - y);
    if (d < bestDistance) {
      bestDistance = d;
      best = n;
    }
  }
  return best;
}

function maxElementSxxAt(mesh: TaggedMesh, solution: Solution, node: number): number {
  let max = -Infinity;
  for (let e = 0; e < mesh.elements.length / 3; e++) {
    if ([0, 1, 2].some((k) => mesh.elements[3 * e + k] === node)) max = Math.max(max, solution.elementStress[3 * e]);
  }
  return max;
}
