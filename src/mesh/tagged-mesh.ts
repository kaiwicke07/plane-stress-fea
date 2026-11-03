import type { Mesh } from '../core/model';
import { edgeMidNode } from '../core/topology';

export { edgeMidNode };

/**
 * A mesh that remembers which geometry edge each boundary element edge lies on,
 * so supports and loads defined on geometry survive re-meshing.
 *
 * Boundary edges are oriented with the material on their left, so the outward
 * normal of edge a→b is (Δy, −Δx) / length. They are given by their corner
 * nodes; on a 6-node mesh, edgeMidNode() finds the mid-side node between them.
 */
export interface TaggedMesh extends Mesh {
  /** Boundary element edges, 2 corner node indices per edge. */
  boundaryEdges: Uint32Array;
  /** Geometry edge ID of each boundary edge. */
  boundaryTags: Uint32Array;
}

/** Boundary element edges lying on geometry edge `tag`, as [a, b] corner pairs. */
export function edgesWithTag(mesh: TaggedMesh, tag: number): [number, number][] {
  const edges: [number, number][] = [];
  for (let k = 0; k < mesh.boundaryTags.length; k++) {
    if (mesh.boundaryTags[k] === tag) edges.push([mesh.boundaryEdges[2 * k], mesh.boundaryEdges[2 * k + 1]]);
  }
  return edges;
}

/** Sorted, unique nodes on geometry edge `tag`: corners and, on a 6-node mesh, mid-side nodes. */
export function nodesWithTag(mesh: TaggedMesh, tag: number): number[] {
  const nodes = new Set<number>();
  for (const [a, b] of edgesWithTag(mesh, tag)) {
    nodes.add(a).add(b);
    const m = edgeMidNode(mesh, a, b);
    if (m !== undefined) nodes.add(m);
  }
  return [...nodes].sort((a, b) => a - b);
}
