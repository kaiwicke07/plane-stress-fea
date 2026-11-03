// 2D regions for the general mesher: an outer polygon minus circular or
// polygonal holes, described by a signed distance function (negative inside).
// Background: docs/math/08-meshing.md.

export type Vec2 = readonly [number, number];

export interface Circle {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
}

/** Simple polygon, vertices counter-clockwise. */
export interface Polygon {
  kind: 'polygon';
  points: readonly Vec2[];
}

export interface Region {
  outer: Polygon;
  holes: readonly (Circle | Polygon)[];
}

/** A geometry edge. Its index in regionCurves() is its ID, used to tag mesh boundary edges. */
export type Curve = { kind: 'segment'; a: Vec2; b: Vec2 } | { kind: 'circle'; cx: number; cy: number; r: number };

/** Outer polygon edges first (in order), then each hole's edges. */
export function regionCurves(region: Region): Curve[] {
  const curves: Curve[] = polygonSegments(region.outer);
  for (const hole of region.holes) {
    if (hole.kind === 'circle') curves.push({ kind: 'circle', cx: hole.cx, cy: hole.cy, r: hole.r });
    else curves.push(...polygonSegments(hole));
  }
  return curves;
}

function polygonSegments({ points }: Polygon): Curve[] {
  return points.map((a, i) => ({ kind: 'segment' as const, a, b: points[(i + 1) % points.length] }));
}

export function distanceToCurve(curve: Curve, x: number, y: number): number {
  if (curve.kind === 'circle') return Math.abs(Math.hypot(x - curve.cx, y - curve.cy) - curve.r);
  return distanceToSegment(curve.a, curve.b, x, y);
}

function distanceToSegment(a: Vec2, b: Vec2, x: number, y: number): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSq)) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/** Signed distance to a polygon's boundary: negative inside (even–odd rule). */
function polygonDistance({ points }: Polygon, x: number, y: number): number {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    d = Math.min(d, distanceToSegment(points[j], points[i], x, y));
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? -d : d;
}

function shapeDistance(shape: Circle | Polygon, x: number, y: number): number {
  return shape.kind === 'circle' ? Math.hypot(x - shape.cx, y - shape.cy) - shape.r : polygonDistance(shape, x, y);
}

/**
 * Signed distance to the region boundary, negative inside. The difference
 * A − B is max(d_A, −d_B): exact in sign everywhere, and a distance bound
 * near the corners where the two boundaries meet, which is all DistMesh needs.
 */
export function signedDistance(region: Region, x: number, y: number): number {
  let d = polygonDistance(region.outer, x, y);
  for (const hole of region.holes) d = Math.max(d, -shapeDistance(hole, x, y));
  return d;
}

/** Distance from (x, y) to the nearest hole boundary, or Infinity if there are no holes. */
export function distanceToHoles(region: Region, x: number, y: number): number {
  let d = Infinity;
  for (const hole of region.holes) d = Math.min(d, Math.abs(shapeDistance(hole, x, y)));
  return d;
}

export function regionBounds(region: Region): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = region.outer.points.map((p) => p[0]);
  const ys = region.outer.points.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * Corners the mesh must keep exactly: outer and hole polygon vertices that lie
 * on the final boundary, and points where a circular hole cuts an outer edge.
 */
export function fixedPoints(region: Region, tolerance: number): Vec2[] {
  const candidates: Vec2[] = [...region.outer.points];
  for (const hole of region.holes) {
    if (hole.kind === 'polygon') {
      candidates.push(...hole.points);
      continue;
    }
    for (const seg of polygonSegments(region.outer)) {
      if (seg.kind === 'segment') candidates.push(...segmentCircleIntersections(seg.a, seg.b, hole));
    }
  }
  const out: Vec2[] = [];
  for (const p of candidates) {
    if (Math.abs(signedDistance(region, p[0], p[1])) > tolerance) continue;
    if (out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < tolerance)) continue;
    out.push(p);
  }
  return out;
}

function segmentCircleIntersections(a: Vec2, b: Vec2, c: Circle): Vec2[] {
  // |a + t(b − a) − centre|² = r², t ∈ [0, 1].
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const [fx, fy] = [a[0] - c.cx, a[1] - c.cy];
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - c.r * c.r;
  const disc = B * B - 4 * A * C;
  if (A === 0 || disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-B - root) / (2 * A), (-B + root) / (2 * A)]
    .filter((t) => t >= 0 && t <= 1)
    .map((t) => [a[0] + t * dx, a[1] + t * dy] as const);
}
