// 6-node (quadratic) meshes from 3-node ones, and back to linear triangles
// for display. Background: docs/math/10-lst-element.md.

import type { Curve } from './geometry';
import type { TaggedMesh } from './tagged-mesh';

/**
 * Adds a mid-side node on every element edge, shared by the two elements on
 * either side. Corner nodes keep their indices; mid-side nodes are appended.
 * With `curves` (indexed by boundary tag), mid-side nodes on a circular
 * boundary are moved onto the circle, giving curved, isoparametric edges.
 */
export function elevateToQuadratic(mesh: TaggedMesh, curves?: readonly Curve[]): TaggedMesh {
  if (mesh.midNodes) return mesh;
  const { nodes, elements } = mesh;
  const nCorners = nodes.length / 2;

  // Which geometry curve each boundary edge lies on.
  const boundaryCurve = new Map<number, Curve>();
  if (curves) {
    for (let k = 0; k < mesh.boundaryTags.length; k++) {
      const curve = curves[mesh.boundaryTags[k]];
      if (curve) boundaryCurve.set(key(mesh.boundaryEdges[2 * k], mesh.boundaryEdges[2 * k + 1], nCorners), curve);
    }
  }

  const created = new Map<number, number>();
  const extra: number[] = [];
  const midNodes = new Uint32Array(elements.length);
  for (let e = 0; e < elements.length / 3; e++) {
    for (let k = 0; k < 3; k++) {
      const a = elements[3 * e + k];
      const b = elements[3 * e + ((k + 1) % 3)];
      const id = key(a, b, nCorners);
      let m = created.get(id);
      if (m === undefined) {
        let x = (nodes[2 * a] + nodes[2 * b]) / 2;
        let y = (nodes[2 * a + 1] + nodes[2 * b + 1]) / 2;
        const curve = boundaryCurve.get(id);
        if (curve?.kind === 'circle') {
          const d = Math.hypot(x - curve.cx, y - curve.cy);
          if (d > 0) [x, y] = [curve.cx + ((x - curve.cx) * curve.r) / d, curve.cy + ((y - curve.cy) * curve.r) / d];
        }
        m = nCorners + extra.length / 2;
        extra.push(x, y);
        created.set(id, m);
      }
      midNodes[3 * e + k] = m;
    }
  }

  const all = new Float64Array(nodes.length + extra.length);
  all.set(nodes);
  all.set(extra, nodes.length);
  return { ...mesh, nodes: all, midNodes };
}

/**
 * Splits each 6-node element into four 3-node triangles, for drawing:
 * (1, 4, 6), (4, 2, 5), (6, 5, 3), (4, 5, 6). Node indices are unchanged, so
 * nodal results apply directly; `parent` maps each triangle to its element.
 * Boundary edges are split at their mid-side nodes and keep their tags, and
 * `lines` lists the true element edges for drawing the mesh.
 */
export function linearDisplayMesh(mesh: TaggedMesh): { mesh: TaggedMesh; parent: Uint32Array; lines?: Uint32Array } {
  const mids = mesh.midNodes;
  const nElements = mesh.elements.length / 3;
  if (!mids) return { mesh, parent: Uint32Array.from({ length: nElements }, (_, e) => e) };

  const elements = new Uint32Array(4 * mesh.elements.length);
  const parent = new Uint32Array(4 * nElements);
  for (let e = 0; e < nElements; e++) {
    const [c1, c2, c3] = [mesh.elements[3 * e], mesh.elements[3 * e + 1], mesh.elements[3 * e + 2]];
    const [m4, m5, m6] = [mids[3 * e], mids[3 * e + 1], mids[3 * e + 2]];
    elements.set([c1, m4, m6, m4, c2, m5, m6, m5, c3, m4, m5, m6], 12 * e);
    parent.fill(e, 4 * e, 4 * e + 4);
  }

  const n = mesh.nodes.length / 2;
  const midOf = new Map<number, number>();
  for (let e = 0; e < nElements; e++) {
    for (let k = 0; k < 3; k++) {
      midOf.set(key(mesh.elements[3 * e + k], mesh.elements[3 * e + ((k + 1) % 3)], n), mids[3 * e + k]);
    }
  }
  const boundaryEdges: number[] = [];
  const boundaryTags: number[] = [];
  for (let k = 0; k < mesh.boundaryTags.length; k++) {
    const [a, b] = [mesh.boundaryEdges[2 * k], mesh.boundaryEdges[2 * k + 1]];
    const m = midOf.get(key(a, b, n));
    if (m === undefined) {
      boundaryEdges.push(a, b);
      boundaryTags.push(mesh.boundaryTags[k]);
    } else {
      boundaryEdges.push(a, m, m, b);
      boundaryTags.push(mesh.boundaryTags[k], mesh.boundaryTags[k]);
    }
  }

  // Mesh lines: the real element edges, each drawn as two segments through its
  // mid-side node. The split's internal lines are not element edges.
  const lines: number[] = [];
  for (const [id, m] of midOf) {
    const a = Math.floor(id / n);
    const b = id % n;
    lines.push(a, m, m, b);
  }

  return {
    mesh: {
      nodes: mesh.nodes,
      elements,
      boundaryEdges: Uint32Array.from(boundaryEdges),
      boundaryTags: Uint32Array.from(boundaryTags),
    },
    parent,
    lines: Uint32Array.from(lines),
  };
}

function key(a: number, b: number, n: number): number {
  return Math.min(a, b) * n + Math.max(a, b);
}
