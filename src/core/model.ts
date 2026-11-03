// Data types shared by the solver. Units throughout: N, mm, MPa (= N/mm²).

/** A mesh of 3-node triangles. */
export interface Mesh {
  /** Node coordinates, interleaved [x0, y0, x1, y1, ...] in mm. */
  nodes: Float64Array;
  /** Connectivity, 3 node indices per element, ordered counter-clockwise. */
  elements: Uint32Array;
}

export interface Material {
  name: string;
  /** Young's modulus, MPa. */
  E: number;
  /** Poisson's ratio. */
  nu: number;
  /** Yield strength, MPa. Used only for the factor of safety. */
  yieldStrength: number;
}

export type Direction = 'x' | 'y';

/** Prescribed displacement of one node in one direction. */
export interface Constraint {
  node: number;
  direction: Direction;
  /** Prescribed displacement in mm. Defaults to 0 (a support). */
  value?: number;
}

/**
 * Uniform traction on one element edge, in MPa (force per unit area of the edge
 * face). Components are in global x and y.
 */
export interface EdgeTraction {
  nodes: readonly [number, number];
  tx: number;
  ty: number;
}

/**
 * Nodal force in N. Holds consistent nodal forces computed ahead of time (for
 * example by tractionFieldLoads). Not offered as a UI load type, because a true
 * concentrated load gives unbounded stress in 2D.
 */
export interface PointLoad {
  node: number;
  fx: number;
  fy: number;
}

export interface Model {
  mesh: Mesh;
  material: Material;
  /** Out-of-plane thickness, mm. */
  thickness: number;
  constraints: Constraint[];
  tractions?: EdgeTraction[];
  pointLoads?: PointLoad[];
}

export interface Solution {
  /** Nodal displacements [u0, v0, u1, v1, ...], mm. */
  displacements: Float64Array;
  /** Reaction forces at constrained DOFs, N. Zero at free DOFs. */
  reactions: Float64Array;
  /** Element stresses [σx, σy, τxy] per element, MPa. Constant within each CST. */
  elementStress: Float64Array;
  /** Von Mises stress per element, MPa. */
  elementVonMises: Float64Array;
  /** Area-weighted nodal average of element stresses, [σx, σy, τxy] per node, MPa. */
  nodalStress: Float64Array;
  /** Von Mises stress computed from the averaged nodal components, MPa. */
  nodalVonMises: Float64Array;
  solver: {
    method: 'pcg' | 'cholesky';
    iterations: number;
    relativeResidual: number;
  };
}

/** Global DOF index of a node's x or y displacement. */
export function dofIndex(node: number, direction: Direction): number {
  return 2 * node + (direction === 'x' ? 0 : 1);
}
