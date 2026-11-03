// Pure helpers for the editor canvas: what is under the cursor, grid snapping.

import { deleteHole, deleteVertex, type EdgeId, type EditorGeometry, type Point, type VertexRef } from './model';

/**
 * Deletes what is selected: a corner (polygons keep at least three), or the
 * hole that owns a selected hole or hole edge. Outline edges cannot be deleted.
 */
export function deleteSelection(geo: EditorGeometry, selection: Selection): EditorGeometry {
  if (!selection) return geo;
  if (selection.kind === 'vertex') return deleteVertex(geo, selection);
  if (selection.kind === 'hole') return deleteHole(geo, selection.hole);
  const owner = geo.holes.find((h) => (h.kind === 'circle' ? h.edge === selection.edge : h.edges.includes(selection.edge)));
  return owner ? deleteHole(geo, owner.id) : geo;
}

/** What is selected in the editor. A circle's edge is selected as an edge. */
export type Selection =
  | { kind: 'vertex'; hole?: string; index: number }
  | { kind: 'edge'; edge: EdgeId }
  | { kind: 'hole'; hole: string }
  | null;

export type Hit =
  | { kind: 'vertex'; ref: VertexRef }
  | { kind: 'circle-centre'; hole: string }
  | { kind: 'circle-edge'; hole: string; edge: EdgeId }
  | { kind: 'edge'; edge: EdgeId; hole?: string; at: Point };

/**
 * The item under world point p within `tolerance` mm. Vertices and circle
 * centres win over edges, so a corner can be grabbed where two edges meet.
 */
export function hitTest(geo: EditorGeometry, p: Point, tolerance: number): Hit | null {
  const polygons = [
    { hole: undefined as string | undefined, points: geo.outline.points, edges: geo.outline.edges },
    ...geo.holes.flatMap((h) => (h.kind === 'polygon' ? [{ hole: h.id, points: h.points, edges: h.edges }] : [])),
  ];

  let best: { hit: Hit; d: number } | null = null;
  const consider = (hit: Hit, d: number) => {
    if (d <= tolerance && (!best || d < best.d)) best = { hit, d };
  };

  for (const { hole, points } of polygons) {
    points.forEach((q, index) => consider({ kind: 'vertex', ref: { hole, index } }, dist(p, q)));
  }
  for (const h of geo.holes) {
    if (h.kind === 'circle') consider({ kind: 'circle-centre', hole: h.id }, dist(p, [h.cx, h.cy]));
  }
  if (best) return (best as { hit: Hit }).hit;

  for (const { hole, points, edges } of polygons) {
    for (let i = 0; i < points.length; i++) {
      const { d, at } = closestOnSegment(points[i], points[(i + 1) % points.length], p);
      consider({ kind: 'edge', edge: edges[i], hole, at }, d);
    }
  }
  for (const h of geo.holes) {
    if (h.kind === 'circle') {
      consider({ kind: 'circle-edge', hole: h.id, edge: h.edge }, Math.abs(dist(p, [h.cx, h.cy]) - h.r));
    }
  }
  return best ? (best as { hit: Hit }).hit : null;
}

export function closestOnSegment(a: Point, b: Point, p: Point): { d: number; at: Point } {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq)) : 0;
  const at: Point = [a[0] + t * dx, a[1] + t * dy];
  return { d: dist(p, at), at };
}

/**
 * Grid spacing from the 1–2–5 sequence (…, 1, 2, 5, 10, 20, … mm) that is
 * closest to `targetPx` screen pixels at the current zoom (px per mm).
 */
export function gridStep(zoom: number, targetPx = 24): number {
  const raw = targetPx / zoom;
  const decade = 10 ** Math.floor(Math.log10(raw));
  let best = decade;
  for (const m of [1, 2, 5, 10]) {
    if (Math.abs(Math.log(m * decade) - Math.log(raw)) < Math.abs(Math.log(best) - Math.log(raw))) best = m * decade;
  }
  return best;
}

export function snapPoint(p: Point, step: number): Point {
  // Round, then clean up float noise such as 0.30000000000000004.
  const clean = (v: number) => Number((Math.round(v / step) * step).toPrecision(12));
  return [clean(p[0]), clean(p[1])];
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
