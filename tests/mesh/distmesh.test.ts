import { describe, expect, it } from 'vitest';
import { elementB } from '../../src/core/elements/cst';
import { distmesh } from '../../src/mesh/distmesh';
import {
  distanceToHoles,
  fixedPoints,
  type Region,
  regionCurves,
  signedDistance,
} from '../../src/mesh/geometry';
import { meshQuality, radiusRatio } from '../../src/mesh/quality';
import { edgesWithTag, nodesWithTag } from '../../src/mesh/tagged-mesh';

// Quarter of a 100 × 50 plate with a radius-5 hole at the origin.
const quarterPlate: Region = {
  outer: {
    kind: 'polygon',
    points: [
      [0, 0],
      [50, 0],
      [50, 25],
      [0, 25],
    ],
  },
  holes: [{ kind: 'circle', cx: 0, cy: 0, r: 5 }],
};
const EDGE = { bottom: 0, right: 1, top: 2, left: 3, hole: 4 };

describe('region geometry', () => {
  it('has negative distance inside, positive outside and in the hole', () => {
    expect(signedDistance(quarterPlate, 20, 10)).toBeCloseTo(-10, 12); // nearest boundary: bottom edge, 10 away
    expect(signedDistance(quarterPlate, 60, 10)).toBeCloseTo(10, 12);
    expect(signedDistance(quarterPlate, 1, 1)).toBeGreaterThan(0); // inside the hole
    expect(signedDistance(quarterPlate, 5, 0)).toBeCloseTo(0, 12);
  });

  it('lists outer edges then the hole as geometry edges', () => {
    const curves = regionCurves(quarterPlate);
    expect(curves.length).toBe(5);
    expect(curves[EDGE.hole].kind).toBe('circle');
  });

  it('keeps corners on the boundary and adds hole–edge intersections', () => {
    const fixed = fixedPoints(quarterPlate, 1e-9).map(([x, y]) => `${x},${y}`).sort();
    // (0, 0) is inside the hole, so it is dropped; (5, 0) and (0, 5) are added.
    expect(fixed).toEqual(['0,25', '0,5', '50,0', '50,25', '5,0'].sort());
  });

  it('measures radius ratio as 1 for equilateral and → 0 for slivers', () => {
    expect(radiusRatio(1, 1, 1)).toBeCloseTo(1, 14);
    expect(radiusRatio(1, 1, 1.999)).toBeLessThan(0.01);
  });
});

describe('distmesh on a quarter plate with a hole', () => {
  const hHole = 0.5;
  const result = distmesh(quarterPlate, {
    hMin: hHole,
    size: (x, y) => Math.min(3, hHole + 0.25 * distanceToHoles(quarterPlate, x, y)),
  });
  const { mesh } = result;

  it('converges to a good-quality mesh', () => {
    expect(result.converged).toBe(true);
    const q = meshQuality(mesh);
    expect(q.minAngle).toBeGreaterThan(30);
    expect(q.meanRadiusRatio).toBeGreaterThan(0.95);
    expect(q.poorFraction).toBe(0);
  });

  it('fills the region: counter-clockwise elements, area within the chord error of the hole', () => {
    const B = new Float64Array(18);
    let area = 0;
    for (let e = 0; e < mesh.elements.length / 3; e++) area += elementB(mesh, e, B); // throws if clockwise
    const exact = 50 * 25 - (Math.PI * 25) / 4;
    // Chords cut the hole's arc short, so the mesh is slightly too big: error ≲ arc length × sag.
    expect(area).toBeGreaterThan(exact);
    expect(area - exact).toBeLessThan(((Math.PI * 5) / 2) * (hHole ** 2 / (8 * 5)) * 2);
  });

  it('uses every node and puts boundary nodes on the boundary', () => {
    const used = new Set(mesh.elements);
    expect(used.size).toBe(mesh.nodes.length / 2);
    for (const n of new Set(mesh.boundaryEdges)) {
      expect(Math.abs(signedDistance(quarterPlate, mesh.nodes[2 * n], mesh.nodes[2 * n + 1]))).toBeLessThan(1e-6);
    }
  });

  it('tags every geometry edge, with nodes that lie on it', () => {
    for (const tag of Object.values(EDGE)) expect(edgesWithTag(mesh, tag).length).toBeGreaterThan(0);
    for (const n of nodesWithTag(mesh, EDGE.left)) expect(mesh.nodes[2 * n]).toBeCloseTo(0, 6);
    for (const n of nodesWithTag(mesh, EDGE.bottom)) expect(mesh.nodes[2 * n + 1]).toBeCloseTo(0, 6);
    for (const n of nodesWithTag(mesh, EDGE.hole)) {
      expect(Math.hypot(mesh.nodes[2 * n], mesh.nodes[2 * n + 1])).toBeCloseTo(5, 6);
    }
    // The corner points where the hole meets the symmetry edges are mesh nodes.
    const hasNode = (x: number, y: number) =>
      Array.from({ length: mesh.nodes.length / 2 }, (_, k) => k).some(
        (k) => Math.hypot(mesh.nodes[2 * k] - x, mesh.nodes[2 * k + 1] - y) < 1e-9,
      );
    expect(hasNode(0, 5)).toBe(true);
    expect(hasNode(5, 0)).toBe(true);
  });

  it('grades element size away from the hole', () => {
    // Mean edge length of hole-boundary edges vs top-edge edges.
    const mean = (tag: number) => {
      const edges = edgesWithTag(mesh, tag);
      return (
        edges.reduce(
          (s, [a, b]) => s + Math.hypot(mesh.nodes[2 * b] - mesh.nodes[2 * a], mesh.nodes[2 * b + 1] - mesh.nodes[2 * a + 1]),
          0,
        ) / edges.length
      );
    };
    expect(mean(EDGE.hole)).toBeLessThan(0.8);
    expect(mean(EDGE.right)).toBeGreaterThan(2);
  });

  it('is reproducible for a given seed', () => {
    const again = distmesh(quarterPlate, {
      hMin: hHole,
      size: (x, y) => Math.min(3, hHole + 0.25 * distanceToHoles(quarterPlate, x, y)),
    });
    expect(Array.from(again.mesh.nodes)).toEqual(Array.from(mesh.nodes));
  });
});
