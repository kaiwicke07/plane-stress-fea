// Checks a geometry before meshing, with messages a user can act on.
// Rigid-body restraint is checked later by the solver, which names the
// missing direction.

import { type Polygon, signedDistance } from '../mesh/geometry';
import { type EditorGeometry, type HoleSpec, type Point, type PolygonSpec, signedArea2 } from './model';

export interface Issue {
  level: 'error' | 'warning';
  message: string;
}

export function validateGeometry(geo: EditorGeometry): Issue[] {
  const issues: Issue[] = [];
  const error = (message: string) => issues.push({ level: 'error', message });

  const outline = geo.outline.points;
  if (outline.length < 3) {
    error('Draw an outline with at least three corners.');
    return issues;
  }
  const outlineProblem = polygonProblem(outline);
  if (outlineProblem) error(`Outline: ${outlineProblem}`);

  const outer: Polygon = { kind: 'polygon', points: outline };
  geo.holes.forEach((hole, k) => {
    const name = `Hole ${k + 1}`;
    if (hole.kind === 'circle') {
      // A circle may cut the outline (a notch, or a symmetry model's quarter hole),
      // but must overlap the part and must not swallow all of it.
      if (!(hole.r > 0)) error(`${name}: radius must be positive.`);
      else if (signedDistance({ outer, holes: [] }, hole.cx, hole.cy) >= hole.r) error(`${name}: lies outside the part.`);
      else if (outline.every((p) => Math.hypot(p[0] - hole.cx, p[1] - hole.cy) <= hole.r)) {
        error(`${name}: covers the whole part.`);
      }
      return;
    }
    const problem = polygonProblem(hole.points);
    if (problem) error(`${name}: ${problem}`);
    else if (!polygonInside(hole, outline)) error(`${name}: must lie entirely inside the outline.`);
  });

  for (let i = 0; i < geo.holes.length; i++) {
    for (let j = i + 1; j < geo.holes.length; j++) {
      if (holesOverlap(geo.holes[i], geo.holes[j])) error(`Holes ${i + 1} and ${j + 1} overlap.`);
    }
  }

  const conditions = Object.values(geo.conditions);
  if (!conditions.some((c) => c.support)) error('Add a support: select an edge and choose fixed or a roller.');
  if (!conditions.some((c) => c.load)) error('Add a load: select an edge and give it a force or pressure.');
  return issues;
}

/** Why a polygon is unusable, or null if it is a simple polygon with area. */
export function polygonProblem(points: readonly Point[]): string | null {
  const n = points.length;
  if (n < 3) return 'needs at least three corners.';
  const scale = Math.max(...points.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))), 1);
  for (let i = 0; i < n; i++) {
    const [a, b] = [points[i], points[(i + 1) % n]];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9 * scale) return 'two corners are at the same point.';
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // Neighbouring edges share a corner; they are only a problem if they fold back onto each other.
        const shared = j === i + 1 ? points[j] : points[0];
        const before = j === i + 1 ? points[i] : points[n - 1];
        const after = j === i + 1 ? points[(j + 1) % n] : points[1];
        if (foldsBack(before, shared, after)) return 'an edge doubles back on its neighbour.';
        continue;
      }
      if (segmentsIntersect(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) {
        return 'edges cross each other.';
      }
    }
  }
  if (Math.abs(signedArea2(points)) < 1e-12 * scale * scale) return 'has no area.';
  return null;
}

function orient(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Closed-segment intersection test, including touching and collinear overlap. */
export function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = orient(q1, q2, p1);
  const d2 = orient(q1, q2, p2);
  const d3 = orient(p1, p2, q1);
  const d4 = orient(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const onSegment = (a: Point, b: Point, c: Point) =>
    Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  return (
    (d1 === 0 && onSegment(q1, q2, p1)) ||
    (d2 === 0 && onSegment(q1, q2, p2)) ||
    (d3 === 0 && onSegment(p1, p2, q1)) ||
    (d4 === 0 && onSegment(p1, p2, q2))
  );
}

/** True if edge before→shared and shared→after are collinear and point back over each other. */
function foldsBack(before: Point, shared: Point, after: Point): boolean {
  if (orient(before, shared, after) !== 0) return false;
  const dot = (shared[0] - before[0]) * (after[0] - shared[0]) + (shared[1] - before[1]) * (after[1] - shared[1]);
  return dot < 0;
}

function polygonInside(inner: PolygonSpec, outline: readonly Point[]): boolean {
  const region = { outer: { kind: 'polygon' as const, points: outline }, holes: [] };
  if (!inner.points.every((p) => signedDistance(region, p[0], p[1]) < 0)) return false;
  for (let i = 0; i < inner.points.length; i++) {
    for (let j = 0; j < outline.length; j++) {
      const [a, b] = [inner.points[i], inner.points[(i + 1) % inner.points.length]];
      if (segmentsIntersect(a, b, outline[j], outline[(j + 1) % outline.length])) return false;
    }
  }
  return true;
}

function holesOverlap(a: HoleSpec, b: HoleSpec): boolean {
  if (a.kind === 'circle' && b.kind === 'circle') return Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r;
  if (a.kind === 'circle' || b.kind === 'circle') {
    const [circle, poly] = (a.kind === 'circle' ? [a, b] : [b, a]) as [
      Extract<HoleSpec, { kind: 'circle' }>,
      Extract<HoleSpec, { kind: 'polygon' }>,
    ];
    const region = { outer: { kind: 'polygon' as const, points: poly.points }, holes: [] };
    const d = signedDistance(region, circle.cx, circle.cy);
    return d < circle.r; // centre inside the polygon (d < 0) or closer than r to it
  }
  const pa = a as Extract<HoleSpec, { kind: 'polygon' }>;
  const pb = b as Extract<HoleSpec, { kind: 'polygon' }>;
  const regionB = { outer: { kind: 'polygon' as const, points: pb.points }, holes: [] };
  const regionA = { outer: { kind: 'polygon' as const, points: pa.points }, holes: [] };
  if (pa.points.some((p) => signedDistance(regionB, p[0], p[1]) <= 0)) return true;
  if (pb.points.some((p) => signedDistance(regionA, p[0], p[1]) <= 0)) return true;
  for (let i = 0; i < pa.points.length; i++) {
    for (let j = 0; j < pb.points.length; j++) {
      if (
        segmentsIntersect(
          pa.points[i],
          pa.points[(i + 1) % pa.points.length],
          pb.points[j],
          pb.points[(j + 1) % pb.points.length],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}
