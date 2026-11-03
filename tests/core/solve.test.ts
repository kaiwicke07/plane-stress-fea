import { describe, expect, it } from 'vitest';
import { assembleStiffness } from '../../src/core/assembly';
import { addTractionLoads, partitionDofs, reduceSystem } from '../../src/core/boundary';
import { elementB } from '../../src/core/elements/cst';
import { choleskySolve } from '../../src/core/linalg/dense';
import { NotPositiveDefiniteError } from '../../src/core/linalg/errors';
import { csrMatVec, csrToDense } from '../../src/core/linalg/sparse';
import { planeStressD } from '../../src/core/material';
import type { Constraint, Model } from '../../src/core/model';
import { nodalAverage, vonMises } from '../../src/core/postprocess';
import { solve } from '../../src/core/solve';
import { rectangleMesh } from '../../src/mesh/structured';
import { mesh, patchMesh, STEEL } from '../fixtures/meshes';

const { E, nu } = STEEL;
const D = planeStressD(E, nu);

function fix(node: number, ...directions: ('x' | 'y')[]): Constraint[] {
  return directions.map((direction) => ({ node, direction }));
}

/** Left edge of a rectangle mesh fully fixed. */
function clampLeftEdge(nx: number, ny: number): Constraint[] {
  return Array.from({ length: ny + 1 }, (_, j) => fix(j * (nx + 1), 'x', 'y')).flat();
}

describe('patch mesh fixture', () => {
  it('tiles the 2×2 square with counter-clockwise elements', () => {
    const m = patchMesh();
    const B = new Float64Array(18);
    let total = 0;
    for (let e = 0; e < m.elements.length / 3; e++) total += elementB(m, e, B);
    expect(total).toBeCloseTo(4, 14);
  });
});

describe('rigid-body modes', () => {
  const m = patchMesh();
  const K = assembleStiffness(m, D, 1);
  const nDofs = m.nodes.length;

  it('produce zero force: K·r = 0 for two translations and a rotation', () => {
    const modes: ((x: number, y: number) => number[])[] = [
      () => [1, 0],
      () => [0, 1],
      (x, y) => [-y, x], // small rotation about the origin
    ];
    const Kr = new Float64Array(nDofs);
    for (const mode of modes) {
      const r = new Float64Array(nDofs);
      for (let n = 0; n < nDofs / 2; n++) r.set(mode(m.nodes[2 * n], m.nodes[2 * n + 1]), 2 * n);
      csrMatVec(K, r, Kr);
      for (const f of Kr) expect(Math.abs(f)).toBeLessThan(1e-9 * E);
    }
  });

  // Together these show K has exactly 3 zero eigenvalues: the 3 modes above
  // are in its null space, and removing 3 well-chosen DOFs leaves an SPD matrix.
  it('are the only zero-energy modes: pin + roller leaves K_ff positive definite', () => {
    const part = partitionDofs(8, [...fix(0, 'x', 'y'), ...fix(1, 'y')]);
    const { Kff } = reduceSystem(K, new Float64Array(nDofs), part);
    expect(() => choleskySolve(csrToDense(Kff), new Float64Array(Kff.n))).not.toThrow();
  });

  it('leave K_ff singular when only a pin is applied (rotation is free)', () => {
    const part = partitionDofs(8, fix(0, 'x', 'y'));
    const { Kff } = reduceSystem(K, new Float64Array(nDofs), part);
    expect(() => choleskySolve(csrToDense(Kff), new Float64Array(Kff.n))).toThrow(NotPositiveDefiniteError);
  });
});

describe('patch tests', () => {
  // A linear displacement field has constant strain, which CST represents
  // exactly. On any mesh, the FE solution must reproduce it exactly.
  it('reproduces a linear displacement field from boundary values (displacement patch test)', () => {
    const field = (x: number, y: number) => [1e-3 + 2e-4 * x - 1e-4 * y, -5e-4 + 3e-4 * x + 4e-4 * y];
    const m = patchMesh();
    const constraints: Constraint[] = [];
    for (let n = 0; n < 4; n++) {
      const [u, v] = field(m.nodes[2 * n], m.nodes[2 * n + 1]);
      constraints.push({ node: n, direction: 'x', value: u }, { node: n, direction: 'y', value: v });
    }
    const result = solve({ mesh: m, material: STEEL, thickness: 1, constraints });

    for (let n = 4; n < 8; n++) {
      const [u, v] = field(m.nodes[2 * n], m.nodes[2 * n + 1]);
      expect(result.displacements[2 * n]).toBeCloseTo(u, 14);
      expect(result.displacements[2 * n + 1]).toBeCloseTo(v, 14);
    }
    // ε = (2e-4, 4e-4, −1e-4 + 3e-4) in every element.
    const strain = [2e-4, 4e-4, 2e-4];
    const sigma = [0, 1, 2].map((i) => D[3 * i] * strain[0] + D[3 * i + 1] * strain[1] + D[3 * i + 2] * strain[2]);
    for (let e = 0; e < 10; e++) {
      for (let c = 0; c < 3; c++) expect(result.elementStress[3 * e + c]).toBeCloseTo(sigma[c], 8);
    }
  });

  it('gives uniform stress under an edge traction (force patch test)', () => {
    // Uniaxial tension σ on the right edge, symmetric rollers on the left edge.
    const sigma = 50;
    const t = 2;
    const m = patchMesh();
    const result = solve({
      mesh: m,
      material: STEEL,
      thickness: t,
      constraints: [...fix(0, 'x', 'y'), ...fix(3, 'x')],
      tractions: [{ nodes: [1, 2], tx: sigma, ty: 0 }],
    });

    for (let e = 0; e < 10; e++) {
      expect(result.elementStress[3 * e]).toBeCloseTo(sigma, 8);
      expect(result.elementStress[3 * e + 1]).toBeCloseTo(0, 8);
      expect(result.elementStress[3 * e + 2]).toBeCloseTo(0, 8);
      expect(result.elementVonMises[e]).toBeCloseTo(sigma, 8);
    }
    // Exact displacements: u = σx/E, v = −νσy/E.
    for (let n = 0; n < 8; n++) {
      const [x, y] = [m.nodes[2 * n], m.nodes[2 * n + 1]];
      expect(result.displacements[2 * n]).toBeCloseTo((sigma * x) / E, 14);
      expect(result.displacements[2 * n + 1]).toBeCloseTo((-nu * sigma * y) / E, 14);
    }
    // Nodal averaging preserves a constant field.
    for (let n = 0; n < 8; n++) expect(result.nodalStress[3 * n]).toBeCloseTo(sigma, 8);
  });
});

describe('cantilever: equilibrium and solver agreement', () => {
  // 100 × 20 mm, 5 mm thick, clamped on the left, shear traction on the right.
  const [L, H, nx, ny] = [100, 20, 20, 4];
  const m = rectangleMesh({ width: L, height: H, nx, ny });
  const rightEdge = Array.from({ length: ny }, (_, j) => ({
    nodes: [j * (nx + 1) + nx, (j + 1) * (nx + 1) + nx] as const,
    tx: 0,
    ty: -10,
  }));
  const model: Model = {
    mesh: m,
    material: STEEL,
    thickness: 5,
    constraints: clampLeftEdge(nx, ny),
    tractions: rightEdge,
  };
  const P = 10 * H * 5; // total applied force, N

  it('PCG and dense Cholesky give the same displacements', () => {
    const iterative = solve(model, { tolerance: 1e-12 });
    const direct = solve(model, { linearSolver: 'cholesky' });
    const scale = Math.max(...direct.displacements.map(Math.abs));
    for (let i = 0; i < direct.displacements.length; i++) {
      expect(Math.abs(iterative.displacements[i] - direct.displacements[i])).toBeLessThan(1e-9 * scale);
    }
    expect(iterative.solver.method).toBe('pcg');
    expect(iterative.solver.iterations).toBeGreaterThan(0);
    expect(iterative.solver.iterations).toBeLessThan(m.nodes.length);
  });

  it('reactions balance the applied load in force and moment', () => {
    const { reactions } = solve(model, { tolerance: 1e-12 });
    let Rx = 0;
    let Ry = 0;
    let M = 0; // about the origin
    for (let n = 0; n < m.nodes.length / 2; n++) {
      const [x, y] = [m.nodes[2 * n], m.nodes[2 * n + 1]];
      Rx += reactions[2 * n];
      Ry += reactions[2 * n + 1];
      M += x * reactions[2 * n + 1] - y * reactions[2 * n];
    }
    expect(Rx / P).toBeCloseTo(0, 8);
    expect(Ry / P).toBeCloseTo(1, 8); // reaction balances the downward load P
    // The load P acts downward at x = L, so the wall moment is +P·L.
    expect(M / (P * L)).toBeCloseTo(1, 8);
  });

  it('deflects downward, by less than beam theory on this coarse CST mesh', () => {
    // CST is too stiff in bending; Phase 2 studies the convergence properly.
    const { displacements } = solve(model);
    const tip = displacements[2 * nx + 1];
    const I = (5 * H ** 3) / 12;
    const beam = (P * L ** 3) / (3 * E * I);
    expect(tip).toBeLessThan(0);
    expect(-tip).toBeLessThan(beam);
    expect(-tip).toBeGreaterThan(0.5 * beam);
  });
});

describe('loads', () => {
  it('splits an edge traction equally between its two nodes', () => {
    const m = mesh([0, 0, 3, 0, 0, 1], [0, 1, 2]);
    const F = new Float64Array(6);
    addTractionLoads(m, [{ nodes: [0, 1], tx: 0, ty: 5 }], 2, F);
    // Total force = traction × edge length × thickness = 5 × 3 × 2 = 30 N.
    expect(Array.from(F)).toEqual([0, 15, 0, 15, 0, 0]);
  });

  it('rejects a traction on a pair of nodes that is not an element edge', () => {
    const m = rectangleMesh({ width: 1, height: 1, nx: 2, ny: 2 });
    expect(() => addTractionLoads(m, [{ nodes: [0, 8], tx: 1, ty: 0 }], 1, new Float64Array(18))).toThrow(
      /not an element edge/,
    );
  });
});

describe('boundary condition validation', () => {
  const m = patchMesh();
  const base = { mesh: m, material: STEEL, thickness: 1 };

  it('names the missing restraint', () => {
    expect(() => solve({ ...base, constraints: fix(0, 'x') })).toThrow(/translation in y/);
    expect(() => solve({ ...base, constraints: fix(0, 'y') })).toThrow(/translation in x/);
    expect(() => solve({ ...base, constraints: fix(0, 'x', 'y') })).toThrow(/rotation/);
    // Two x-rollers at the same height can't stop rotation; at different heights they can.
    expect(() => solve({ ...base, constraints: [...fix(0, 'x', 'y'), ...fix(1, 'x')] })).toThrow(/rotation/);
    expect(() => solve({ ...base, constraints: [...fix(0, 'x', 'y'), ...fix(3, 'x')] })).not.toThrow();
  });

  it('rejects conflicting prescribed values on one DOF', () => {
    expect(() =>
      solve({
        ...base,
        constraints: [...fix(0, 'x', 'y'), ...fix(1, 'y'), { node: 0, direction: 'x', value: 1 }],
      }),
    ).toThrow(/conflicting/);
  });

  it('reports a node not attached to any element', () => {
    const orphan = mesh([0, 0, 1, 0, 0, 1, 5, 5], [0, 1, 2]);
    expect(() =>
      solve({ mesh: orphan, material: STEEL, thickness: 1, constraints: [...fix(0, 'x', 'y'), ...fix(1, 'y')] }),
    ).toThrow(/singular/);
  });
});

describe('post-processing', () => {
  it('computes von Mises for the standard stress states', () => {
    expect(vonMises(100, 0, 0)).toBe(100); // uniaxial
    expect(vonMises(100, 100, 0)).toBe(100); // equibiaxial
    expect(vonMises(0, 0, 100)).toBeCloseTo(100 * Math.sqrt(3), 12); // pure shear
    expect(vonMises(100, -100, 0)).toBeCloseTo(100 * Math.sqrt(3), 12); // same state, principal axes
  });

  it('weights nodal averages by element area', () => {
    // Areas ½ and 3/2 share nodes 1 and 2.
    const m = mesh([0, 0, 1, 0, 0, 1, 3, 1], [0, 1, 2, 1, 3, 2]);
    const stress = new Float64Array([1, 0, 0, 5, 0, 0]);
    const nodal = nodalAverage(m, stress, new Float64Array([0.5, 1.5]));
    expect([nodal[0], nodal[3], nodal[6], nodal[9]]).toEqual([1, 4, 4, 5]);
  });
});
