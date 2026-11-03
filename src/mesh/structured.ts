// Structured triangle mesh of a rectangle. Used for presets and for validation,
// where a regular mesh makes refinement studies clean.

import type { TaggedMesh } from './tagged-mesh';

/** Geometry edge IDs of a rectangle, counter-clockwise from the bottom. */
export const RECT_EDGE = { bottom: 0, right: 1, top: 2, left: 3 } as const;

export interface RectangleMeshOptions {
  /** Lower-left corner. Defaults to (0, 0). */
  x0?: number;
  y0?: number;
  width: number;
  height: number;
  /** Number of cells along x and y. */
  nx: number;
  ny: number;
  /**
   * How each cell is split into two triangles. 'right' uses the same diagonal
   * everywhere; 'alternating' flips it in a checkerboard, which removes the
   * directional bias of a single diagonal.
   */
  pattern?: 'right' | 'alternating';
}

/**
 * Node (i, j) is at (x0 + i·width/nx, y0 + j·height/ny) and has index
 * j·(nx + 1) + i.
 */
export function rectangleMesh({
  x0 = 0,
  y0 = 0,
  width,
  height,
  nx,
  ny,
  pattern = 'right',
}: RectangleMeshOptions): TaggedMesh {
  if (!(width > 0 && height > 0)) throw new RangeError('Rectangle must have positive width and height');
  if (!(Number.isInteger(nx) && Number.isInteger(ny) && nx >= 1 && ny >= 1)) {
    throw new RangeError(`Cell counts must be positive integers, got ${nx} × ${ny}`);
  }

  const id = (i: number, j: number) => j * (nx + 1) + i;

  const nodes = new Float64Array(2 * (nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      nodes[2 * id(i, j)] = x0 + (width * i) / nx;
      nodes[2 * id(i, j) + 1] = y0 + (height * j) / ny;
    }
  }

  const elements = new Uint32Array(6 * nx * ny);
  let e = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // Cell corners, counter-clockwise from lower left.
      const n0 = id(i, j);
      const n1 = id(i + 1, j);
      const n2 = id(i + 1, j + 1);
      const n3 = id(i, j + 1);
      if (pattern === 'right' || (i + j) % 2 === 0) {
        elements.set([n0, n1, n2, n0, n2, n3], e); // diagonal n0–n2
      } else {
        elements.set([n0, n1, n3, n1, n2, n3], e); // diagonal n1–n3
      }
      e += 6;
    }
  }

  // Boundary edges, counter-clockwise so the material is on the left.
  const boundaryEdges: number[] = [];
  const boundaryTags: number[] = [];
  const addEdge = (a: number, b: number, tag: number) => {
    boundaryEdges.push(a, b);
    boundaryTags.push(tag);
  };
  for (let i = 0; i < nx; i++) addEdge(id(i, 0), id(i + 1, 0), RECT_EDGE.bottom);
  for (let j = 0; j < ny; j++) addEdge(id(nx, j), id(nx, j + 1), RECT_EDGE.right);
  for (let i = nx; i > 0; i--) addEdge(id(i, ny), id(i - 1, ny), RECT_EDGE.top);
  for (let j = ny; j > 0; j--) addEdge(id(0, j), id(0, j - 1), RECT_EDGE.left);

  return {
    nodes,
    elements,
    boundaryEdges: Uint32Array.from(boundaryEdges),
    boundaryTags: Uint32Array.from(boundaryTags),
  };
}
