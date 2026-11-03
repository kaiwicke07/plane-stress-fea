// End-to-end linear static solve: assemble, apply boundary conditions, solve,
// recover reactions and stresses.

import { assembleLoads, assembleStiffness } from './assembly';
import { checkRigidBodyRestraint, partitionDofs, reduceSystem } from './boundary';
import { choleskySolve } from './linalg/dense';
import { NotPositiveDefiniteError } from './linalg/errors';
import { pcg } from './linalg/pcg';
import { csrMatVec, csrToDense } from './linalg/sparse';
import { planeStressD } from './material';
import type { Model, Solution } from './model';
import { elementStresses, nodalAverage, vonMisesField } from './postprocess';

export interface SolveOptions {
  /** 'pcg' for real models; 'cholesky' (dense, O(n³)) as a reference on small ones. */
  linearSolver?: 'pcg' | 'cholesky';
  /** PCG relative residual tolerance. */
  tolerance?: number;
  maxIterations?: number;
}

export function solve(model: Model, options: SolveOptions = {}): Solution {
  const { mesh, material, thickness, constraints } = model;
  const method = options.linearSolver ?? 'pcg';
  const nNodes = mesh.nodes.length / 2;
  if (!(thickness > 0)) throw new RangeError(`Thickness must be positive, got ${thickness}`);
  checkRigidBodyRestraint(mesh, constraints);

  // 1. Assemble K·u = F.
  const D = planeStressD(material.E, material.nu);
  const K = assembleStiffness(mesh, D, thickness);
  const F = assembleLoads(model);

  // 2. Eliminate prescribed DOFs: K_ff·u_f = F_f − K_fc·u_c.
  const partition = partitionDofs(nNodes, constraints);
  const { Kff, rhs } = reduceSystem(K, F, partition);

  // 3. Solve the reduced SPD system.
  let uFree: Float64Array;
  let iterations = 0;
  let relativeResidual = 0;
  try {
    if (method === 'cholesky') {
      uFree = choleskySolve(csrToDense(Kff), rhs);
    } else {
      ({ x: uFree, iterations, relativeResidual } = pcg(Kff, rhs, options));
    }
  } catch (error) {
    if (!(error instanceof NotPositiveDefiniteError)) throw error;
    throw new Error(
      'Stiffness matrix is singular: part of the model can move without deforming ' +
        '(a node not attached to any element, or regions joined only at a single node)',
      { cause: error },
    );
  }

  // 4. Full displacement vector, then reactions R = K·u − F at prescribed DOFs.
  const u = partition.prescribed.slice();
  partition.freeDofs.forEach((dof, fi) => (u[dof] = uFree[fi]));

  const Ku = new Float64Array(u.length);
  csrMatVec(K, u, Ku);
  const reactions = new Float64Array(u.length);
  for (let dof = 0; dof < u.length; dof++) {
    if (partition.freeIndex[dof] < 0) reactions[dof] = Ku[dof] - F[dof];
  }

  // 5. Stresses.
  const { stress, area } = elementStresses(mesh, D, u);
  const nodalStress = nodalAverage(mesh, stress, area);

  return {
    displacements: u,
    reactions,
    elementStress: stress,
    elementVonMises: vonMisesField(stress),
    nodalStress,
    nodalVonMises: vonMisesField(nodalStress),
    solver: { method, iterations, relativeResidual },
  };
}
