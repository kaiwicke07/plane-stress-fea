// Finding which element contains a point, for the hover probe.

/** Node positions after scaling the displacements: x + s·u. */
export function deformedPositions(nodes: Float64Array, u: Float64Array, scale: number): Float64Array {
  const out = new Float64Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) out[i] = nodes[i] + scale * u[i];
  return out;
}

export interface Hit {
  element: number;
  /** Barycentric coordinates (shape function values) of the point. */
  weights: [number, number, number];
}

/**
 * Element containing (x, y), with the point's barycentric coordinates, or null.
 * Linear scan: fine for the mesh sizes here, run at most once per frame.
 */
export function locate(positions: Float64Array, elements: Uint32Array, x: number, y: number): Hit | null {
  const eps = 1e-12;
  for (let e = 0; e < elements.length / 3; e++) {
    const a = elements[3 * e];
    const b = elements[3 * e + 1];
    const c = elements[3 * e + 2];
    const [xa, ya, xb, yb, xc, yc] = [
      positions[2 * a],
      positions[2 * a + 1],
      positions[2 * b],
      positions[2 * b + 1],
      positions[2 * c],
      positions[2 * c + 1],
    ];
    const twoA = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya);
    if (twoA === 0) continue;
    // Each weight is the signed area of the sub-triangle opposite that node.
    const l1 = ((xb - x) * (yc - y) - (xc - x) * (yb - y)) / twoA;
    const l2 = ((xc - x) * (ya - y) - (xa - x) * (yc - y)) / twoA;
    const l3 = 1 - l1 - l2;
    if (l1 >= -eps && l2 >= -eps && l3 >= -eps) return { element: e, weights: [l1, l2, l3] };
  }
  return null;
}
