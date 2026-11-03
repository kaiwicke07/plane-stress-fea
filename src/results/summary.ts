// Headline numbers for the results panel.

import type { SolveResult } from '../worker/job';

export interface ResultSummary {
  maxDisplacement: number;
  maxDisplacementNode: number;
  /** Largest element (centroid) von Mises stress, MPa. */
  maxElementVonMises: number;
  /** Largest nodal-averaged von Mises stress, MPa. */
  maxNodalVonMises: number;
  /** Yield strength over the larger of the two maxima. Infinity if unstressed. */
  factorOfSafety: number;
  reaction: [number, number];
  /** |ΣR + ΣF| / |ΣF|: zero for a solution in equilibrium. */
  equilibriumError: number;
  dofs: number;
  elements: number;
}

export function summarize(result: SolveResult): ResultSummary {
  const { mesh, solution, material, appliedForce } = result;
  const u = solution.displacements;

  let maxDisplacement = 0;
  let maxDisplacementNode = 0;
  for (let n = 0; n < u.length / 2; n++) {
    const d = Math.hypot(u[2 * n], u[2 * n + 1]);
    if (d > maxDisplacement) {
      maxDisplacement = d;
      maxDisplacementNode = n;
    }
  }

  let rx = 0;
  let ry = 0;
  for (let i = 0; i < solution.reactions.length; i += 2) {
    rx += solution.reactions[i];
    ry += solution.reactions[i + 1];
  }

  const maxElementVonMises = max(solution.elementVonMises);
  const maxNodalVonMises = max(solution.nodalVonMises);
  const peak = Math.max(maxElementVonMises, maxNodalVonMises);
  const applied = Math.hypot(appliedForce[0], appliedForce[1]);

  return {
    maxDisplacement,
    maxDisplacementNode,
    maxElementVonMises,
    maxNodalVonMises,
    factorOfSafety: peak > 0 ? material.yieldStrength / peak : Infinity,
    reaction: [rx, ry],
    equilibriumError: applied > 0 ? Math.hypot(rx + appliedForce[0], ry + appliedForce[1]) / applied : 0,
    dofs: u.length,
    elements: mesh.elements.length / 3,
  };
}

/**
 * Deformation scale factor so the largest displacement appears as `fraction`
 * of the part's size. Linear theory makes any scale equally valid.
 */
export function autoDeformationScale(result: SolveResult, fraction = 0.1): number {
  const { nodes } = result.mesh;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < nodes.length; i += 2) {
    minX = Math.min(minX, nodes[i]);
    maxX = Math.max(maxX, nodes[i]);
    minY = Math.min(minY, nodes[i + 1]);
    maxY = Math.max(maxY, nodes[i + 1]);
  }
  const size = Math.max(maxX - minX, maxY - minY);
  const { maxDisplacement } = summarize(result);
  return maxDisplacement > 0 ? (fraction * size) / maxDisplacement : 1;
}

function max(values: Float64Array): number {
  let m = 0;
  for (const v of values) if (v > m) m = v;
  return m;
}
