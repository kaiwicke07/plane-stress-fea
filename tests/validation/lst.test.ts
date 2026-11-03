// 6-node LST against the same references as CST, through the shared criteria
// the validation page displays.

import { describe, expect, it } from 'vitest';
import { cantileverConvergence, DEFAULT_CANTILEVER } from '../../src/validation/cases';
import { lstCantileverChecks, lstPlateCheck } from '../../src/validation/criteria';
import { edgesWithTag, nodesWithTag } from '../../src/mesh/tagged-mesh';
import { holeMesh, KIRSCH_PLATE, PLATE_EDGE, plateSetup, runPlate } from '../../src/validation/plate-cases';
import { LST_LEVELS, LST_PLATE_LEVELS } from '../../src/validation/suite';

describe('LST cantilever with exact wall displacements', { timeout: 60_000 }, () => {
  const lst = cantileverConvergence(DEFAULT_CANTILEVER, LST_LEVELS, 'alternating', 2);
  const cst = cantileverConvergence(DEFAULT_CANTILEVER, [2, 4, 8, 16, 32], 'alternating', 1);

  it.each(lstCantileverChecks(lst, cst))('$label: $measured (required $required)', (check) => {
    expect(check.pass).toBe(true);
  });

  it('reduces the energy error at every refinement', () => {
    for (let k = 1; k < lst.runs.length; k++) expect(lst.runs[k].energy).toBeLessThan(lst.runs[k - 1].energy);
  });

  it('recovers midspan bending stress to 5 digits, where CST needs SPR and still misses', () => {
    const coarse = lst.runs[1];
    expect(Math.abs(coarse.midspanStress / coarse.beamMidspanStress - 1)).toBeLessThan(1e-4);
  });
});

describe('LST plate with curved hole edges', { timeout: 60_000 }, () => {
  const k = LST_PLATE_LEVELS[LST_PLATE_LEVELS.length - 1];
  const run = runPlate(KIRSCH_PLATE, holeMesh(KIRSCH_PLATE, k), 2);

  it('puts every hole-edge node, including mid-side nodes, on the true circle', () => {
    const { mesh } = plateSetup(KIRSCH_PLATE, holeMesh(KIRSCH_PLATE, 4), 2);
    const onHole = nodesWithTag(mesh, PLATE_EDGE.hole);
    const corners = new Set(edgesWithTag(mesh, PLATE_EDGE.hole).flat());
    expect(onHole.length).toBe(2 * corners.size - 1); // an open arc: one mid-side node between each pair
    for (const n of onHole) {
      expect(Math.hypot(mesh.nodes[2 * n], mesh.nodes[2 * n + 1])).toBeCloseTo(KIRSCH_PLATE.holeDiameter / 2, 7); // corners: DistMesh projection tolerance
    }
  });

  it.each([lstPlateCheck(run, k)])('$label: $measured (required $required)', (check) => {
    expect(check.pass).toBe(true);
  });
});
