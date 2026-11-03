import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../../src/core/material';
import {
  addCircleHole,
  addPolygonHole,
  deleteHole,
  deleteVertex,
  edgeLength,
  emptyGeometry,
  insertVertex,
  moveVertex,
  setCondition,
  setOutline,
  updateCircle,
} from '../../src/editor/model';
import { buildStudy, meshSizing } from '../../src/editor/study';
import { TEMPLATES, templateById } from '../../src/editor/templates';
import { polygonProblem, validateGeometry } from '../../src/editor/validate';
import { edgesWithTag, nodesWithTag } from '../../src/mesh/tagged-mesh';
import { summarize } from '../../src/results/summary';
import { runJob } from '../../src/worker/job';

const square = () =>
  setOutline(emptyGeometry(), [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]);

describe('editor geometry operations', () => {
  it('gives every edge a stable, unique ID', () => {
    const geo = square();
    expect(geo.outline.edges).toEqual(['e1', 'e2', 'e3', 'e4']);
    const withHole = addCircleHole(geo, 5, 5, 1);
    expect(withHole.holes[0]).toMatchObject({ id: 'h5', edge: 'h6' });
  });

  it('splits an edge on insert, and both halves keep its condition', () => {
    let geo = setCondition(square(), 'e2', { support: 'fixed' });
    geo = insertVertex(geo, 'e2', [10, 4]);
    expect(geo.outline.points).toEqual([
      [0, 0],
      [10, 0],
      [10, 4],
      [10, 10],
      [0, 10],
    ]);
    const [, first, second] = geo.outline.edges;
    expect(first).toBe('e2');
    expect(geo.conditions[first]).toEqual({ support: 'fixed' });
    expect(geo.conditions[second]).toEqual({ support: 'fixed' });
    expect(edgeLength(geo, first) + edgeLength(geo, second)).toBeCloseTo(10, 12);
  });

  it('merges edges on delete, keeping the incoming edge and its condition', () => {
    let geo = insertVertex(square(), 'e2', [10, 4]); // e2 then e5 on the right side
    geo = setCondition(geo, 'e2', { load: { kind: 'pressure', p: 1 } });
    geo = setCondition(geo, geo.outline.edges[2], { support: 'roller-x' });
    geo = deleteVertex(geo, { index: 2 });
    expect(geo.outline.edges).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(geo.conditions.e2).toEqual({ load: { kind: 'pressure', p: 1 } });
    expect(Object.keys(geo.conditions)).toEqual(['e2']);
  });

  it('keeps at least three vertices', () => {
    let geo = deleteVertex(square(), { index: 0 });
    expect(geo.outline.points.length).toBe(3);
    geo = deleteVertex(geo, { index: 0 });
    expect(geo.outline.points.length).toBe(3);
  });

  it('moves vertices and edits holes without touching other data', () => {
    let geo = addCircleHole(square(), 5, 5, 1);
    geo = moveVertex(geo, { index: 2 }, [12, 11]);
    geo = updateCircle(geo, geo.holes[0].id, { r: 2 });
    expect(geo.outline.points[2]).toEqual([12, 11]);
    expect(geo.holes[0]).toMatchObject({ cx: 5, cy: 5, r: 2 });
  });

  it('drops a deleted hole and its conditions', () => {
    let geo = addPolygonHole(square(), [
      [3, 3],
      [6, 3],
      [6, 6],
    ]);
    const hole = geo.holes[0];
    if (hole.kind !== 'polygon') throw new Error('expected polygon hole');
    geo = setCondition(geo, hole.edges[0], { support: 'fixed' });
    geo = deleteHole(geo, hole.id);
    expect(geo.holes).toEqual([]);
    expect(geo.conditions).toEqual({});
  });

  it('removes a condition when it is set to empty', () => {
    const geo = setCondition(setCondition(square(), 'e1', { support: 'fixed' }), 'e1', {});
    expect(geo.conditions).toEqual({});
  });
});

describe('geometry validation', () => {
  const ready = (geo = square()) =>
    setCondition(setCondition(geo, 'e4', { support: 'fixed' }), 'e2', { load: { kind: 'force', fx: 1, fy: 0 } });

  it('accepts a valid part', () => {
    expect(validateGeometry(ready())).toEqual([]);
  });

  it('asks for supports and loads', () => {
    const messages = validateGeometry(square()).map((i) => i.message);
    expect(messages.some((m) => /support/.test(m))).toBe(true);
    expect(messages.some((m) => /load/.test(m))).toBe(true);
  });

  it('detects crossing, doubled-back and zero-length edges', () => {
    expect(polygonProblem([[0, 0], [10, 10], [10, 0], [0, 10]])).toMatch(/cross/);
    expect(polygonProblem([[0, 0], [10, 0], [5, 0], [5, 5]])).toMatch(/doubles back/);
    expect(polygonProblem([[0, 0], [0, 0], [5, 0], [5, 5]])).toMatch(/same point/);
    expect(polygonProblem([[0, 0], [10, 0], [10, 10]])).toBeNull();
  });

  it('rejects holes outside the part, covering it, or overlapping', () => {
    const outside = validateGeometry(ready(addCircleHole(square(), 30, 30, 1)));
    expect(outside.map((i) => i.message).join()).toMatch(/outside the part/);
    const covering = validateGeometry(ready(addCircleHole(square(), 5, 5, 20)));
    expect(covering.map((i) => i.message).join()).toMatch(/covers the whole part/);
    const overlapping = validateGeometry(ready(addCircleHole(addCircleHole(square(), 4, 5, 1.5), 6, 5, 1.5)));
    expect(overlapping.map((i) => i.message).join()).toMatch(/overlap/);
    const polyOut = validateGeometry(ready(addPolygonHole(square(), [[8, 8], [12, 8], [12, 12]])));
    expect(polyOut.map((i) => i.message).join()).toMatch(/inside the outline/);
  });

  it('allows a circle that cuts the outline, as in a symmetry model', () => {
    expect(validateGeometry(ready(addCircleHole(square(), 0, 0, 3)))).toEqual([]);
  });

  it('accepts every template', () => {
    for (const t of TEMPLATES) expect(validateGeometry(t.build())).toEqual([]);
  });
});

describe('geometry to study', () => {
  it('scales element size with density and refines at holes', () => {
    const bracket = templateById('bracket').build();
    const coarse = meshSizing(bracket, 4);
    const fine = meshSizing(bracket, 8);
    expect(coarse.h).toBeCloseTo(2 * fine.h, 12); // 20 mm leg / density
    expect(fine.h).toBeCloseTo(20 / 8, 12);
    expect(fine.hHole).toBeLessThan(fine.h);
  });

  it('maps edge IDs to mesh tags, including supports on hole edges', () => {
    const bracket = templateById('bracket').build();
    const setup = buildStudy(bracket, 4);
    expect(setup.supports.map((s) => s.edge)).toEqual([6, 7]); // the two bolt holes, after 6 outline edges
    expect(setup.loads.map((l) => l.edge)).toEqual([3]);
    for (const n of nodesWithTag(setup.mesh, 6)) {
      expect(Math.hypot(setup.mesh.nodes[2 * n] - 10, setup.mesh.nodes[2 * n + 1] - 15)).toBeCloseTo(4, 6);
    }
    expect(edgesWithTag(setup.mesh, 3).length).toBeGreaterThan(0);
  });

  it('solves every template in the worker job, in equilibrium', () => {
    for (const t of TEMPLATES) {
      const result = runJob({
        id: 1,
        source: { kind: 'custom', geometry: t.build() },
        density: 4,
        material: MATERIALS[0],
        thickness: 5,
      });
      expect(summarize(result).equilibriumError).toBeLessThan(1e-6);
    }
  });

  it('bracket: bolt reactions carry the 300 N tip load', () => {
    const result = runJob({
      id: 1,
      source: { kind: 'custom', geometry: templateById('bracket').build() },
      density: 6,
      material: MATERIALS[0],
      thickness: 5,
    });
    const { reaction } = summarize(result);
    expect(reaction[0]).toBeCloseTo(0, 6);
    expect(reaction[1]).toBeCloseTo(300, 6);
  });

  it('reports a loaded edge that a hole cuts away completely', () => {
    let geo = setCondition(square(), 'e4', { support: 'fixed' });
    geo = setCondition(geo, 'e1', { load: { kind: 'force', fx: 0, fy: -1 } });
    // A hole centred on the bottom edge, wide enough to remove all of it.
    geo = addCircleHole(geo, 5, -1, 6);
    expect(() => buildStudy(geo, 4)).toThrow(/cut away/);
  });
});
