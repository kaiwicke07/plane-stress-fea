// What the solver worker does, as a plain function so it can be unit tested
// without a Worker.

import { assembleLoads } from '../core/assembly';
import type { Material, Solution } from '../core/model';
import { solve } from '../core/solve';
import type { TaggedMesh } from '../mesh/tagged-mesh';
import type { EditorGeometry } from '../editor/model';
import { buildStudy } from '../editor/study';
import { buildModel, type EdgeLoad, type EdgeSupport, type StudySetup } from '../model/spec';
import { presetById } from '../presets';

/** What to solve: a built-in preset, or geometry from the editor. */
export type JobSource =
  | { kind: 'preset'; presetId: string; values: Record<string, number> }
  | { kind: 'custom'; geometry: EditorGeometry };

export interface SolveJob {
  id: number;
  source: JobSource;
  density: number;
  material: Material;
  thickness: number;
}

function setupFor({ source, density }: SolveJob): StudySetup {
  return source.kind === 'preset'
    ? presetById(source.presetId).build(source.values, density)
    : buildStudy(source.geometry, density);
}

export interface SolveResult {
  id: number;
  mesh: TaggedMesh;
  supports: EdgeSupport[];
  loads: EdgeLoad[];
  material: Material;
  thickness: number;
  solution: Solution;
  /** Sum of applied nodal forces, N. */
  appliedForce: [number, number];
  timing: { meshMs: number; solveMs: number };
}

export type WorkerResponse = { type: 'result'; result: SolveResult } | { type: 'error'; id: number; message: string };

export function runJob(job: SolveJob): SolveResult {
  const t0 = performance.now();
  const setup = setupFor(job);
  const t1 = performance.now();

  const model = buildModel(setup, job.material, job.thickness);
  const F = assembleLoads(model);
  let fx = 0;
  let fy = 0;
  for (let i = 0; i < F.length; i += 2) {
    fx += F[i];
    fy += F[i + 1];
  }
  const solution = solve(model);
  const t2 = performance.now();

  return {
    id: job.id,
    ...setup,
    material: job.material,
    thickness: job.thickness,
    solution,
    appliedForce: [fx, fy],
    timing: { meshMs: t1 - t0, solveMs: t2 - t1 },
  };
}

/** Buffers to transfer (not copy) back to the main thread. */
export function transferables({ mesh, solution }: SolveResult): ArrayBuffer[] {
  const arrays = [
    mesh.nodes,
    mesh.elements,
    mesh.boundaryEdges,
    mesh.boundaryTags,
    solution.displacements,
    solution.reactions,
    solution.elementStress,
    solution.elementVonMises,
    solution.nodalStress,
    solution.nodalVonMises,
    solution.sprStress,
    solution.sprVonMises,
  ];
  // Deduplicate in case two views share a buffer; transferring one twice throws.
  return [...new Set(arrays.map((a) => a.buffer as ArrayBuffer))];
}
