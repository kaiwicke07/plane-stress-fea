// Supports and loads defined on geometry edges, and their conversion to a
// solver Model on a particular mesh. Because they refer to geometry, not mesh
// nodes, they survive re-meshing at a different density.

import { tractionFieldLoads } from '../core/boundary';
import type { Constraint, EdgeTraction, Material, Model } from '../core/model';
import { edgesWithTag, nodesWithTag, type TaggedMesh } from '../mesh/tagged-mesh';

/** Which displacement components a support fixes. */
export type SupportKind = 'fixed' | 'roller-x' | 'roller-y';

/** 'roller-x' fixes u (the edge can slide in y); 'roller-y' fixes v. */
export interface EdgeSupport {
  edge: number;
  kind: SupportKind;
}

export type EdgeLoad =
  /** Total force in N, spread uniformly along the edge. */
  | { edge: number; kind: 'force'; fx: number; fy: number }
  /** Uniform traction in MPa, global components. */
  | { edge: number; kind: 'traction'; tx: number; ty: number }
  /** Uniform pressure in MPa acting into the material (negative pulls outward). */
  | { edge: number; kind: 'pressure'; p: number }
  /**
   * Total shear force in N with the parabolic distribution of beam theory,
   * zero at the edge ends. Only meaningful on a straight edge.
   */
  | { edge: number; kind: 'parabolic-shear'; fx: number; fy: number };

/** Mesh plus the loads and supports applied to it, before solver conversion. */
export interface StudySetup {
  mesh: TaggedMesh;
  supports: EdgeSupport[];
  loads: EdgeLoad[];
}

export function buildModel(setup: StudySetup, material: Material, thickness: number): Model {
  const { mesh, supports, loads } = setup;
  const constraints: Constraint[] = [];
  for (const { edge, kind } of supports) {
    for (const node of requireNodes(mesh, edge)) {
      if (kind !== 'roller-y') constraints.push({ node, direction: 'x' });
      if (kind !== 'roller-x') constraints.push({ node, direction: 'y' });
    }
  }

  const tractions: EdgeTraction[] = [];
  const pointLoads: NonNullable<Model['pointLoads']> = [];
  for (const load of loads) {
    const edges = edgesWithTag(mesh, load.edge);
    if (edges.length === 0) throw new Error(`Load on geometry edge ${load.edge}, which has no mesh edges`);

    if (load.kind === 'parabolic-shear') {
      pointLoads.push(...parabolicShearLoads(mesh, edges, load.fx, load.fy, thickness));
      continue;
    }

    const length = edges.reduce((sum, [a, b]) => sum + edgeLength(mesh, a, b), 0);
    for (const [a, b] of edges) {
      if (load.kind === 'force') {
        tractions.push({ nodes: [a, b], tx: load.fx / (length * thickness), ty: load.fy / (length * thickness) });
      } else if (load.kind === 'traction') {
        tractions.push({ nodes: [a, b], tx: load.tx, ty: load.ty });
      } else {
        // Material is on the left of a→b, so the outward normal is (Δy, −Δx)/ℓ.
        // Pressure acts against the outward normal.
        const l = edgeLength(mesh, a, b);
        const nx = (mesh.nodes[2 * b + 1] - mesh.nodes[2 * a + 1]) / l;
        const ny = -(mesh.nodes[2 * b] - mesh.nodes[2 * a]) / l;
        tractions.push({ nodes: [a, b], tx: -load.p * nx, ty: -load.p * ny });
      }
    }
  }

  return { mesh, material, thickness, constraints, tractions, pointLoads };
}

/** Length of a geometry edge as meshed, mm. */
export function geometryEdgeLength(mesh: TaggedMesh, edge: number): number {
  return edgesWithTag(mesh, edge).reduce((sum, [a, b]) => sum + edgeLength(mesh, a, b), 0);
}

function parabolicShearLoads(
  mesh: TaggedMesh,
  edges: [number, number][],
  fx: number,
  fy: number,
  thickness: number,
) {
  // Parametrise the edge by distance s from one end: q(s) = 6F·s(ℓ − s)/ℓ³,
  // which integrates to F. Distances are measured from the first node.
  const { nodes } = mesh;
  const [x0, y0] = [nodes[2 * edges[0][0]], nodes[2 * edges[0][0] + 1]];
  const length = edges.reduce((sum, [a, b]) => sum + edgeLength(mesh, a, b), 0);
  const peak = 6 / (length ** 3 * thickness);
  return tractionFieldLoads(
    mesh,
    edges,
    (x, y) => {
      const s = Math.hypot(x - x0, y - y0);
      const shape = peak * s * (length - s);
      return [fx * shape, fy * shape];
    },
    thickness,
  );
}

function edgeLength(mesh: TaggedMesh, a: number, b: number): number {
  return Math.hypot(mesh.nodes[2 * b] - mesh.nodes[2 * a], mesh.nodes[2 * b + 1] - mesh.nodes[2 * a + 1]);
}

function requireNodes(mesh: TaggedMesh, edge: number): number[] {
  const nodes = nodesWithTag(mesh, edge);
  if (nodes.length === 0) throw new Error(`Support on geometry edge ${edge}, which has no mesh edges`);
  return nodes;
}
