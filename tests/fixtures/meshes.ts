import type { Material, Mesh } from '../../src/core/model';

export const STEEL: Material = { name: 'Test steel', E: 200_000, nu: 0.3, yieldStrength: 250 };

export function mesh(nodes: number[], elements: number[]): Mesh {
  return { nodes: Float64Array.from(nodes), elements: Uint32Array.from(elements) };
}

/**
 * Irregular patch on the square [0, 2]², used for patch tests.
 * Nodes 0-3 are the corners (counter-clockwise from the origin), nodes 4-7 are
 * interior and deliberately off-grid. Each interior node i+4 sits "after"
 * corner i, so every element is counter-clockwise.
 */
export function patchMesh(): Mesh {
  const nodes = [
    0, 0,   2, 0,   2, 2,   0, 2,
    0.4, 0.5,   1.5, 0.3,   1.6, 1.4,   0.6, 1.7,
  ];
  const elements: number[] = [];
  for (let k = 0; k < 4; k++) {
    const c0 = k;
    const c1 = (k + 1) % 4;
    const i0 = 4 + k;
    const i1 = 4 + ((k + 1) % 4);
    elements.push(c0, c1, i1, c0, i1, i0);
  }
  elements.push(4, 5, 6, 4, 6, 7);
  return mesh(nodes, elements);
}
