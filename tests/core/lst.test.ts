import { describe, expect, it } from 'vitest';
import { addTractionLoads, tractionFieldLoads } from '../../src/core/boundary';
import { LST_GAUSS, LST_NODE_XI, lstB, lstPoint, lstShape, lstStiffness } from '../../src/core/elements/lst';
import { planeStressD } from '../../src/core/material';
import type { Constraint } from '../../src/core/model';
import { solve } from '../../src/core/solve';
import { elevateToQuadratic, linearDisplayMesh } from '../../src/mesh/quadratic';
import { RECT_EDGE, rectangleMesh } from '../../src/mesh/structured';
import { edgesWithTag, nodesWithTag } from '../../src/mesh/tagged-mesh';
import { STEEL } from '../fixtures/meshes';

/** A straight-sided element: corners plus edge midpoints, [x1, y1, …, x6, y6]. */
function straight(c: number[]): Float64Array {
  const [x1, y1, x2, y2, x3, y3] = c;
  const mid = (a: number, b: number) => (a + b) / 2;
  return Float64Array.from([x1, y1, x2, y2, x3, y3, mid(x1, x2), mid(y1, y2), mid(x2, x3), mid(y2, y3), mid(x3, x1), mid(y3, y1)]);
}

describe('LST shape functions', () => {
  const N = new Float64Array(6);
  const dXi = new Float64Array(6);
  const dEta = new Float64Array(6);

  it('are 1 at their own node and 0 at the others', () => {
    LST_NODE_XI.forEach(([xi, eta], a) => {
      lstShape(xi, eta, N, dXi, dEta);
      for (let b = 0; b < 6; b++) expect(N[b]).toBeCloseTo(a === b ? 1 : 0, 14);
    });
  });

  it('sum to 1 everywhere, so their derivatives sum to 0', () => {
    for (const [xi, eta] of [
      [0.2, 0.3],
      [0.7, 0.1],
      [0.05, 0.9],
    ]) {
      lstShape(xi, eta, N, dXi, dEta);
      expect(N.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 14);
      expect(dXi.reduce((s, v) => s + v, 0)).toBeCloseTo(0, 14);
      expect(dEta.reduce((s, v) => s + v, 0)).toBeCloseTo(0, 14);
    }
  });
});

describe('LST element', () => {
  const coords = straight([0.3, -0.2, 2.1, 0.4, 0.9, 1.7]);
  const D = planeStressD(70_000, 0.33);

  it('has det J = 2A on a straight-sided element, and integrates its area exactly', () => {
    const B = new Float64Array(36);
    const twoA = (2.1 - 0.3) * (1.7 + 0.2) - (0.9 - 0.3) * (0.4 + 0.2);
    expect(lstB(coords, 0.2, 0.3, B)).toBeCloseTo(twoA, 12);
    const ke = new Float64Array(144);
    expect(lstStiffness(coords, D, 1, ke)).toBeCloseTo(twoA / 2, 12);
  });

  it('has a symmetric stiffness with zero force for rigid-body motion', () => {
    const ke = new Float64Array(144);
    lstStiffness(coords, D, 2.5, ke);
    const modes: ((x: number, y: number) => number[])[] = [() => [1, 0], () => [0, 1], (x, y) => [-y, x]];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) expect(ke[12 * i + j]).toBeCloseTo(ke[12 * j + i], 6);
    for (const mode of modes) {
      const r = Array.from({ length: 6 }, (_, a) => mode(coords[2 * a], coords[2 * a + 1])).flat();
      for (let i = 0; i < 12; i++) {
        let f = 0;
        for (let j = 0; j < 12; j++) f += ke[12 * i + j] * r[j];
        expect(Math.abs(f)).toBeLessThan(1e-7 * 70_000);
      }
    }
  });

  it('reproduces the exact linear strain of any quadratic displacement field', () => {
    // u = x² + 2xy, v = 3y² − xy ⇒ εx = 2x + 2y, εy = 6y − x, γxy = 2x − y.
    const field = (x: number, y: number) => [x * x + 2 * x * y, 3 * y * y - x * y];
    const ue = Float64Array.from(Array.from({ length: 6 }, (_, a) => field(coords[2 * a], coords[2 * a + 1])).flat());
    const B = new Float64Array(36);
    for (const [xi, eta] of [...LST_GAUSS.points, [1 / 3, 1 / 3]]) {
      lstB(coords, xi, eta, B);
      const [x, y] = lstPoint(coords, xi, eta);
      const strain = [0, 1, 2].map((r) => B.slice(12 * r, 12 * r + 12).reduce((s, b, j) => s + b * ue[j], 0));
      expect(strain[0]).toBeCloseTo(2 * x + 2 * y, 11);
      expect(strain[1]).toBeCloseTo(6 * y - x, 11);
      expect(strain[2]).toBeCloseTo(2 * x - y, 11);
    }
  });

  it('rejects an inverted element', () => {
    const flipped = straight([0, 0, 0, 1, 1, 0]);
    expect(() => lstB(flipped, 0.2, 0.2, new Float64Array(36), 7)).toThrow(/Element 7 .*Jacobian/);
  });
});

describe('quadratic meshes', () => {
  const linear = rectangleMesh({ width: 4, height: 2, nx: 4, ny: 2, pattern: 'alternating' });
  const quad = elevateToQuadratic(linear);

  it('adds one shared mid-side node per edge, at its midpoint', () => {
    const nEdges = 4 * 3 + 2 * 5 + 4 * 2; // horizontal + vertical + diagonals
    expect(quad.nodes.length / 2).toBe(linear.nodes.length / 2 + nEdges);
    for (let e = 0; e < quad.elements.length / 3; e++) {
      for (let k = 0; k < 3; k++) {
        const [a, b] = [quad.elements[3 * e + k], quad.elements[3 * e + ((k + 1) % 3)]];
        const m = quad.midNodes![3 * e + k];
        expect(quad.nodes[2 * m]).toBeCloseTo((quad.nodes[2 * a] + quad.nodes[2 * b]) / 2, 14);
        expect(quad.nodes[2 * m + 1]).toBeCloseTo((quad.nodes[2 * a + 1] + quad.nodes[2 * b + 1]) / 2, 14);
      }
    }
  });

  it('puts boundary mid-side nodes on a circle when the curve is a circle', () => {
    // Treat the bottom edge as if it were a circle of radius 10 centred at (2, 10).
    const curves = [{ kind: 'circle' as const, cx: 2, cy: 10, r: 10 }];
    const curved = elevateToQuadratic(linear, curves);
    for (const n of nodesWithTag(curved, RECT_EDGE.bottom)) {
      if (n < linear.nodes.length / 2) continue; // corners stay put
      expect(Math.hypot(curved.nodes[2 * n] - 2, curved.nodes[2 * n + 1] - 10)).toBeCloseTo(10, 12);
    }
  });

  it('includes mid-side nodes in tagged edge nodes', () => {
    expect(nodesWithTag(quad, RECT_EDGE.left).length).toBe(5); // 3 corners + 2 mids
  });

  it('splits into four linear triangles per element for display', () => {
    const { mesh, parent } = linearDisplayMesh(quad);
    expect(mesh.elements.length).toBe(4 * quad.elements.length);
    expect(parent.length).toBe(mesh.elements.length / 3);
    expect(mesh.boundaryEdges.length).toBe(2 * quad.boundaryEdges.length);
    let area = 0;
    const n = mesh.nodes;
    for (let t = 0; t < mesh.elements.length; t += 3) {
      const [a, b, c] = [mesh.elements[t], mesh.elements[t + 1], mesh.elements[t + 2]];
      area += ((n[2 * b] - n[2 * a]) * (n[2 * c + 1] - n[2 * a + 1]) - (n[2 * c] - n[2 * a]) * (n[2 * b + 1] - n[2 * a + 1])) / 2;
    }
    expect(area).toBeCloseTo(8, 12);
  });
});

describe('LST edge loads', () => {
  const quad = elevateToQuadratic(rectangleMesh({ y0: -1, width: 1, height: 2, nx: 1, ny: 2 }));
  const t = 2;

  it('splits a uniform traction 1/6, 4/6, 1/6 along each edge', () => {
    const F = new Float64Array(quad.nodes.length);
    const [a, b] = edgesWithTag(quad, RECT_EDGE.right)[0]; // length 1
    addTractionLoads(quad, [{ nodes: [a, b], tx: 6, ty: 0 }], t, F);
    // Total 6 MPa × 1 mm × 2 mm = 12 N.
    const m = nodesWithTag(quad, RECT_EDGE.right).find((k) => k !== a && k !== b && Math.abs(quad.nodes[2 * k + 1] - (quad.nodes[2 * a + 1] + quad.nodes[2 * b + 1]) / 2) < 1e-12)!;
    expect(F[2 * a]).toBeCloseTo(2, 12);
    expect(F[2 * m]).toBeCloseTo(8, 12);
    expect(F[2 * b]).toBeCloseTo(2, 12);
  });

  it('integrates a parabolic traction exactly, with the right total', () => {
    const loads = tractionFieldLoads(quad, edgesWithTag(quad, RECT_EDGE.right), (_x, y) => [0, 1 - y * y], t);
    expect(loads.reduce((s, l) => s + l.fy, 0)).toBeCloseTo((t * 4) / 3, 13);
  });
});

describe('pure bending: LST is exact, CST is not', () => {
  // σx = c·y, σy = τxy = 0 satisfies equilibrium with no body force. Its
  // displacement u = c·x·y/E, v = −c(x² + νy²)/2E is quadratic, so an LST
  // mesh must reproduce it exactly; a CST mesh cannot.
  const c = 50;
  const { E, nu } = STEEL;
  const exactU = (x: number, y: number) => [(c * x * y) / E, (-c * (x * x + nu * y * y)) / (2 * E)];

  function bend(order: 1 | 2) {
    const linear = rectangleMesh({ y0: -1, width: 4, height: 2, nx: 4, ny: 2, pattern: 'alternating' });
    const mesh = order === 2 ? elevateToQuadratic(linear) : linear;
    const constraints: Constraint[] = [];
    for (const tag of Object.values(RECT_EDGE)) {
      for (const n of nodesWithTag(mesh, tag)) {
        const [u, v] = exactU(mesh.nodes[2 * n], mesh.nodes[2 * n + 1]);
        constraints.push({ node: n, direction: 'x', value: u }, { node: n, direction: 'y', value: v });
      }
    }
    return { mesh, solution: solve({ mesh, material: STEEL, thickness: 1, constraints }) };
  }

  it('LST: exact displacements at every node, and exact linear stress everywhere', () => {
    const { mesh, solution } = bend(2);
    const scale = c / E;
    for (let n = 0; n < mesh.nodes.length / 2; n++) {
      const [x, y] = [mesh.nodes[2 * n], mesh.nodes[2 * n + 1]];
      const [u, v] = exactU(x, y);
      expect(Math.abs(solution.displacements[2 * n] - u)).toBeLessThan(1e-10 * scale);
      expect(Math.abs(solution.displacements[2 * n + 1] - v)).toBeLessThan(1e-10 * scale);
      // Nodal and SPR stresses: σx = c·y exactly, the rest zero.
      for (const s of [solution.nodalStress, solution.sprStress]) {
        expect(s[3 * n]).toBeCloseTo(c * y, 8);
        expect(s[3 * n + 1]).toBeCloseTo(0, 8);
        expect(s[3 * n + 2]).toBeCloseTo(0, 8);
      }
    }
  });

  it('CST: interior displacements are off, because constant strain cannot bend', () => {
    const { mesh, solution } = bend(1);
    let worst = 0;
    for (let n = 0; n < mesh.nodes.length / 2; n++) {
      const [u, v] = exactU(mesh.nodes[2 * n], mesh.nodes[2 * n + 1]);
      worst = Math.max(worst, Math.abs(solution.displacements[2 * n] - u), Math.abs(solution.displacements[2 * n + 1] - v));
    }
    expect(worst).toBeGreaterThan(1e-3 * (c / E));
  });
});
