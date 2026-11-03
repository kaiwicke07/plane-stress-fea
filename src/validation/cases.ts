// Validation cases. The test suite and the site's validation page run these
// same functions, so the numbers shown on the site are the ones CI checks.

import { tractionFieldLoads } from '../core/boundary';
import { MATERIALS } from '../core/material';
import type { Constraint, Model } from '../core/model';
import { solve } from '../core/solve';
import { RECT_EDGE, type RectangleMeshOptions, rectangleMesh } from '../mesh/structured';
import { edgesWithTag, nodesWithTag, type TaggedMesh } from '../mesh/tagged-mesh';
import { type CantileverParams, cantileverEndTraction, cantileverExact, timoshenkoTip } from './analytical';
import { errorNorms, observedRates } from './convergence';

export const DEFAULT_CANTILEVER: CantileverParams = {
  length: 100,
  depth: 20,
  thickness: 5,
  load: 1000,
  material: MATERIALS[0],
};

/**
 * 'exact': the wall nodes follow the exact solution, so the FE problem has the
 * analytical field as its exact solution and any error is discretisation error.
 * 'clamped': u = v = 0 on the whole wall, as an engineer would model it.
 */
export type WallCondition = 'exact' | 'clamped';

export type MeshPattern = NonNullable<RectangleMeshOptions['pattern']>;

/**
 * FE model of the cantilever with `ny` square cells through the depth (must be
 * even, so a node sits on the neutral axis at the tip).
 */
export function cantileverModel(
  params: CantileverParams,
  ny: number,
  wall: WallCondition,
  pattern: MeshPattern = 'alternating',
): { model: Model; mesh: TaggedMesh; nx: number; tipNode: number } {
  if (!(Number.isInteger(ny) && ny >= 2 && ny % 2 === 0)) throw new RangeError(`ny must be an even integer ≥ 2, got ${ny}`);
  const { length, depth, thickness, material } = params;
  // Square cells; nx is kept even so a node sits at midspan.
  const nx = 2 * Math.max(1, Math.round((ny * length) / depth / 2));
  const mesh = rectangleMesh({ x0: 0, y0: -depth / 2, width: length, height: depth, nx, ny, pattern });

  const exact = cantileverExact(params);
  const constraints: Constraint[] = nodesWithTag(mesh, RECT_EDGE.left).flatMap((node) => {
    const [u, v] =
      wall === 'exact' ? exact.displacement(mesh.nodes[2 * node], mesh.nodes[2 * node + 1]) : [0, 0];
    return [
      { node, direction: 'x' as const, value: u },
      { node, direction: 'y' as const, value: v },
    ];
  });

  const pointLoads = tractionFieldLoads(
    mesh,
    edgesWithTag(mesh, RECT_EDGE.right),
    cantileverEndTraction(params),
    thickness,
  );

  return {
    model: { mesh, material, thickness, constraints, pointLoads },
    mesh,
    nx,
    tipNode: (ny / 2) * (nx + 1) + nx,
  };
}

export interface CantileverRun {
  nx: number;
  ny: number;
  dofs: number;
  /** Element size (cell edge length), mm. */
  h: number;
  /** FE tip deflection at the neutral axis, positive downward, mm. */
  tipDeflection: number;
  /**
   * FE bending stress σx at the top fibre at midspan (x = L/2), MPa, from
   * area-weighted nodal averaging. Taken at midspan, away from the wall, where
   * the clamped model has corner singularities.
   */
  midspanStress: number;
  /** The same, from superconvergent patch recovery (SPR). */
  midspanSprStress: number;
  /** Beam theory M·c / I at the same point, MPa (also exact in elasticity). */
  beamMidspanStress: number;
  iterations: number;
}

export interface ExactWallRun extends CantileverRun {
  exactTipDeflection: number;
  /** |v_FE − v_exact| / |v_exact| at the tip. */
  tipError: number;
  displacementL2: number;
  energy: number;
}

export interface ClampedWallRun extends CantileverRun {
  timoshenkoTipDeflection: number;
  /** FE tip deflection / Timoshenko beam theory. */
  ratioToTimoshenko: number;
}

function run(params: CantileverParams, ny: number, wall: WallCondition, pattern: MeshPattern) {
  const { model, mesh, nx, tipNode } = cantileverModel(params, ny, wall, pattern);
  const solution = solve(model);
  const { length: L, depth, thickness, load: P } = params;
  const midspanTopNode = ny * (nx + 1) + nx / 2;
  const base: CantileverRun = {
    nx,
    ny,
    dofs: mesh.nodes.length,
    h: depth / ny,
    tipDeflection: -solution.displacements[2 * tipNode + 1],
    midspanStress: solution.nodalStress[3 * midspanTopNode],
    midspanSprStress: solution.sprStress[3 * midspanTopNode],
    beamMidspanStress: (P * (L / 2) * (depth / 2)) / ((thickness * depth ** 3) / 12),
    iterations: solution.solver.iterations,
  };
  return { base, mesh, solution };
}

export function runExactWall(params: CantileverParams, ny: number, pattern: MeshPattern = 'alternating'): ExactWallRun {
  const { base, mesh, solution } = run(params, ny, 'exact', pattern);
  const exact = cantileverExact(params);
  const exactTipDeflection = -exact.displacement(params.length, 0)[1];
  return {
    ...base,
    exactTipDeflection,
    tipError: Math.abs(base.tipDeflection - exactTipDeflection) / exactTipDeflection,
    ...errorNorms(mesh, solution, exact, params.material),
  };
}

export function runClampedWall(
  params: CantileverParams,
  ny: number,
  pattern: MeshPattern = 'alternating',
): ClampedWallRun {
  const { base } = run(params, ny, 'clamped', pattern);
  const timoshenkoTipDeflection = timoshenkoTip(params);
  return { ...base, timoshenkoTipDeflection, ratioToTimoshenko: base.tipDeflection / timoshenkoTipDeflection };
}

export interface ConvergenceStudy {
  runs: ExactWallRun[];
  /** Observed orders between successive levels. */
  rates: { tip: number[]; displacementL2: number[]; energy: number[] };
}

/** Exact-wall refinement study, halving h between levels. */
export function cantileverConvergence(
  params: CantileverParams = DEFAULT_CANTILEVER,
  levels: readonly number[] = [2, 4, 8, 16],
  pattern: MeshPattern = 'alternating',
): ConvergenceStudy {
  const runs = levels.map((ny) => runExactWall(params, ny, pattern));
  const h = runs.map((r) => r.h);
  return {
    runs,
    rates: {
      tip: observedRates(h, runs.map((r) => r.tipError)),
      displacementL2: observedRates(h, runs.map((r) => r.displacementL2)),
      energy: observedRates(h, runs.map((r) => r.energy)),
    },
  };
}
