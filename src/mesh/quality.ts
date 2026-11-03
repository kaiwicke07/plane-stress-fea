// Element quality measures. Background: docs/math/08-meshing.md.

import type { Mesh } from '../core/model';

export interface MeshQuality {
  /** Smallest interior angle in the mesh, degrees (60 for equilateral). */
  minAngle: number;
  /** Radius ratio q = 2·r_in / r_circ: 1 for equilateral, → 0 for slivers. */
  minRadiusRatio: number;
  meanRadiusRatio: number;
  /** Fraction of elements with q < 0.5. */
  poorFraction: number;
}

/** Radius ratio from side lengths: q = (b + c − a)(c + a − b)(a + b − c) / (a·b·c). */
export function radiusRatio(a: number, b: number, c: number): number {
  return ((b + c - a) * (c + a - b) * (a + b - c)) / (a * b * c);
}

export function meshQuality({ nodes, elements }: Mesh): MeshQuality {
  let minAngle = 180;
  let minQ = 1;
  let sumQ = 0;
  let poor = 0;
  const nElements = elements.length / 3;
  const side = (i: number, j: number) => Math.hypot(nodes[2 * i] - nodes[2 * j], nodes[2 * i + 1] - nodes[2 * j + 1]);

  for (let e = 0; e < nElements; e++) {
    const [n1, n2, n3] = [elements[3 * e], elements[3 * e + 1], elements[3 * e + 2]];
    const a = side(n2, n3);
    const b = side(n3, n1);
    const c = side(n1, n2);
    const q = radiusRatio(a, b, c);
    minQ = Math.min(minQ, q);
    sumQ += q;
    if (q < 0.5) poor++;
    // Law of cosines for each angle.
    for (const [opp, s1, s2] of [
      [a, b, c],
      [b, c, a],
      [c, a, b],
    ]) {
      const cos = Math.min(1, Math.max(-1, (s1 * s1 + s2 * s2 - opp * opp) / (2 * s1 * s2)));
      minAngle = Math.min(minAngle, (Math.acos(cos) * 180) / Math.PI);
    }
  }
  return {
    minAngle,
    minRadiusRatio: minQ,
    meanRadiusRatio: nElements > 0 ? sumQ / nElements : 0,
    poorFraction: nElements > 0 ? poor / nElements : 0,
  };
}
