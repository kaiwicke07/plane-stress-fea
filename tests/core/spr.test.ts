import { describe, expect, it } from 'vitest';
import { elementB } from '../../src/core/elements/cst';
import { boundaryNodes, nodalAverage, sprNodalStress } from '../../src/core/postprocess';
import { rectangleMesh } from '../../src/mesh/structured';
import { DEFAULT_CANTILEVER, runClampedWall } from '../../src/validation/cases';
import { patchMesh } from '../fixtures/meshes';

/** Element stresses sampled from a linear field at the centroids, plus areas. */
function sampleLinear(mesh: ReturnType<typeof patchMesh>, field: (x: number, y: number) => number[]) {
  const nElements = mesh.elements.length / 3;
  const stress = new Float64Array(3 * nElements);
  const area = new Float64Array(nElements);
  const B = new Float64Array(18);
  for (let e = 0; e < nElements; e++) {
    area[e] = elementB(mesh, e, B);
    let [cx, cy] = [0, 0];
    for (let a = 0; a < 3; a++) {
      cx += mesh.nodes[2 * mesh.elements[3 * e + a]] / 3;
      cy += mesh.nodes[2 * mesh.elements[3 * e + a] + 1] / 3;
    }
    stress.set(field(cx, cy), 3 * e);
  }
  return { stress, area };
}

describe('SPR stress recovery', () => {
  const field = (x: number, y: number) => [10 + 3 * x - 2 * y, -4 + x + 5 * y, 1 - 2 * x + y];

  for (const [name, mesh] of [
    ['structured mesh', rectangleMesh({ width: 4, height: 3, nx: 8, ny: 6, pattern: 'alternating' })],
    ['irregular patch', patchMesh()],
  ] as const) {
    it(`reproduces a linear stress field exactly at every node (${name})`, () => {
      const { stress, area } = sampleLinear(mesh, field);
      const spr = sprNodalStress(mesh, stress, area);
      for (let n = 0; n < mesh.nodes.length / 2; n++) {
        const exact = field(mesh.nodes[2 * n], mesh.nodes[2 * n + 1]);
        for (let c = 0; c < 3; c++) expect(spr[3 * n + c]).toBeCloseTo(exact[c], 10);
      }
    });
  }

  it('beats nodal averaging at boundary nodes, where averaging is one-sided', () => {
    const mesh = rectangleMesh({ width: 4, height: 3, nx: 8, ny: 6, pattern: 'alternating' });
    const { stress, area } = sampleLinear(mesh, field);
    const average = nodalAverage(mesh, stress, area);
    const onBoundary = boundaryNodes(mesh);
    let worst = 0;
    for (let n = 0; n < mesh.nodes.length / 2; n++) {
      if (!onBoundary[n]) continue;
      worst = Math.max(worst, Math.abs(average[3 * n] - field(mesh.nodes[2 * n], mesh.nodes[2 * n + 1])[0]));
    }
    expect(worst).toBeGreaterThan(0.1); // averaging is biased at the boundary; SPR is exact (above)
  });

  it('finds boundary nodes', () => {
    const mesh = rectangleMesh({ width: 2, height: 2, nx: 2, ny: 2 });
    expect(Array.from(boundaryNodes(mesh))).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1]);
  });

  it('halves the cantilever midspan surface-stress error compared with averaging', () => {
    // Same mesh, same solve; only the recovery differs. SPR removes the one-sided
    // averaging bias, but the CST's own O(h) stress error remains, so the order
    // stays about 1. See docs/math/08-meshing.md.
    const coarse = runClampedWall(DEFAULT_CANTILEVER, 16);
    const fine = runClampedWall(DEFAULT_CANTILEVER, 32);
    const exact = fine.beamMidspanStress;
    for (const run of [coarse, fine]) {
      const errAvg = Math.abs(run.midspanStress / exact - 1);
      const errSpr = Math.abs(run.midspanSprStress / exact - 1);
      expect(errSpr).toBeLessThan(errAvg / 2);
    }
    const rate = Math.log2(Math.abs(coarse.midspanSprStress / exact - 1) / Math.abs(fine.midspanSprStress / exact - 1));
    expect(rate).toBeGreaterThan(0.9);
    expect(rate).toBeLessThan(1.6);
  });
});
