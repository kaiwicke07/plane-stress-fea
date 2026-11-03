import type { Mesh } from './model';

const midNodeMaps = new WeakMap<Uint32Array, Map<number, number>>();

/** The mid-side node on corner edge a–b of a 6-node mesh, or undefined. */
export function edgeMidNode(mesh: Mesh, a: number, b: number): number | undefined {
  const mids = mesh.midNodes;
  if (!mids) return undefined;
  let map = midNodeMaps.get(mids);
  if (!map) {
    map = new Map();
    const { elements } = mesh;
    for (let e = 0; e < elements.length / 3; e++) {
      for (let k = 0; k < 3; k++) {
        map.set(edgeKey(elements[3 * e + k], elements[3 * e + ((k + 1) % 3)]), mids[3 * e + k]);
      }
    }
    midNodeMaps.set(mids, map);
  }
  return map.get(edgeKey(a, b));
}

/** Symmetric key for an edge. Node indices stay far below 2²⁶. */
export function edgeKey(a: number, b: number): number {
  return Math.min(a, b) * 2 ** 26 + Math.max(a, b);
}
