// Editable part geometry: an outline polygon, holes, and supports/loads keyed
// by stable edge IDs. Every operation is pure and returns a new geometry, so
// undo is just keeping old values.
//
// Edge IDs survive editing: inserting a vertex splits an edge and both halves
// keep its support and load; deleting a vertex merges two edges into the first.

import type { SupportKind } from '../model/spec';

export type Point = [number, number];
export type EdgeId = string;

export type LoadSpec =
  /** Total force in N, spread uniformly along the edge. */
  | { kind: 'force'; fx: number; fy: number }
  /** Pressure in MPa acting into the material. */
  | { kind: 'pressure'; p: number }
  /** Traction in MPa, global x and y components. */
  | { kind: 'traction'; tx: number; ty: number };

export interface EdgeCondition {
  support?: SupportKind;
  load?: LoadSpec;
}

/** A closed polygon; edges[i] runs from points[i] to points[(i + 1) % n]. */
export interface PolygonSpec {
  points: Point[];
  edges: EdgeId[];
}

export type HoleSpec =
  | { id: string; kind: 'circle'; cx: number; cy: number; r: number; edge: EdgeId }
  | ({ id: string; kind: 'polygon' } & PolygonSpec);

export interface EditorGeometry {
  outline: PolygonSpec;
  holes: HoleSpec[];
  conditions: Record<EdgeId, EdgeCondition>;
  /** Counter for new IDs, so IDs are deterministic. */
  nextId: number;
}

/** Identifies a vertex of the outline (hole undefined) or of a polygon hole. */
export interface VertexRef {
  hole?: string;
  index: number;
}

export function emptyGeometry(): EditorGeometry {
  return { outline: { points: [], edges: [] }, holes: [], conditions: {}, nextId: 1 };
}

function ids(geo: EditorGeometry, count: number, prefix: string): [string[], number] {
  return [Array.from({ length: count }, (_, k) => `${prefix}${geo.nextId + k}`), geo.nextId + count];
}

/** Replaces the outline. Conditions of the old outline edges are dropped. */
export function setOutline(geo: EditorGeometry, points: Point[]): EditorGeometry {
  const [edges, nextId] = ids(geo, points.length, 'e');
  const conditions = dropConditions(geo.conditions, geo.outline.edges);
  return { ...geo, outline: { points: points.map(copy), edges }, conditions, nextId };
}

export function addCircleHole(geo: EditorGeometry, cx: number, cy: number, r: number): EditorGeometry {
  const [[id, edge], nextId] = ids(geo, 2, 'h');
  return { ...geo, holes: [...geo.holes, { id, kind: 'circle', cx, cy, r, edge }], nextId };
}

export function addPolygonHole(geo: EditorGeometry, points: Point[]): EditorGeometry {
  const [[id, ...edges], nextId] = ids(geo, points.length + 1, 'h');
  return { ...geo, holes: [...geo.holes, { id, kind: 'polygon', points: points.map(copy), edges }], nextId };
}

export function updateCircle(
  geo: EditorGeometry,
  id: string,
  patch: Partial<Pick<Extract<HoleSpec, { kind: 'circle' }>, 'cx' | 'cy' | 'r'>>,
): EditorGeometry {
  return {
    ...geo,
    holes: geo.holes.map((h) => (h.id === id && h.kind === 'circle' ? { ...h, ...patch } : h)),
  };
}

export function deleteHole(geo: EditorGeometry, id: string): EditorGeometry {
  const hole = geo.holes.find((h) => h.id === id);
  if (!hole) return geo;
  return {
    ...geo,
    holes: geo.holes.filter((h) => h.id !== id),
    conditions: dropConditions(geo.conditions, holeEdges(hole)),
  };
}

export function moveVertex(geo: EditorGeometry, ref: VertexRef, to: Point): EditorGeometry {
  return mapPolygon(geo, ref.hole, (poly) => ({
    ...poly,
    points: poly.points.map((p, i) => (i === ref.index ? copy(to) : p)),
  }));
}

/** Splits `edge` at `point`. The new second half inherits the edge's condition. */
export function insertVertex(geo: EditorGeometry, edge: EdgeId, point: Point): EditorGeometry {
  const owner = polygonOwning(geo, edge);
  if (!owner) return geo;
  const [[newEdge], nextId] = ids(geo, 1, 'e');
  const next = mapPolygon(geo, owner.hole, (poly) => {
    const i = poly.edges.indexOf(edge);
    return {
      points: [...poly.points.slice(0, i + 1), copy(point), ...poly.points.slice(i + 1)],
      edges: [...poly.edges.slice(0, i + 1), newEdge, ...poly.edges.slice(i + 1)],
    };
  });
  const inherited = geo.conditions[edge];
  return {
    ...next,
    nextId,
    conditions: inherited ? { ...next.conditions, [newEdge]: structuredClone(inherited) } : next.conditions,
  };
}

/**
 * Removes a vertex, merging its two edges into the incoming one (whose
 * condition is kept). Polygons keep at least three vertices.
 */
export function deleteVertex(geo: EditorGeometry, ref: VertexRef): EditorGeometry {
  const poly = ref.hole ? polygonHole(geo, ref.hole) : geo.outline;
  if (!poly || poly.points.length <= 3) return geo;
  const removedEdge = poly.edges[ref.index];
  const next = mapPolygon(geo, ref.hole, (p) => ({
    points: p.points.filter((_, i) => i !== ref.index),
    edges: p.edges.filter((_, i) => i !== ref.index),
  }));
  return { ...next, conditions: dropConditions(next.conditions, [removedEdge]) };
}

export function setCondition(geo: EditorGeometry, edge: EdgeId, condition: EdgeCondition): EditorGeometry {
  const conditions = { ...geo.conditions };
  if (condition.support || condition.load) conditions[edge] = condition;
  else delete conditions[edge];
  return { ...geo, conditions };
}

/** All edge IDs of the geometry, in region-curve order: outline, then holes. */
export function allEdges(geo: EditorGeometry): EdgeId[] {
  return [...geo.outline.edges, ...geo.holes.flatMap(holeEdges)];
}

export function holeEdges(hole: HoleSpec): EdgeId[] {
  return hole.kind === 'circle' ? [hole.edge] : hole.edges;
}

/** End points of a straight edge, or null for a circle edge. */
export function edgeSegment(geo: EditorGeometry, edge: EdgeId): [Point, Point] | null {
  const owner = polygonOwning(geo, edge);
  if (!owner) return null;
  const { points, edges } = owner.polygon;
  const i = edges.indexOf(edge);
  return [points[i], points[(i + 1) % points.length]];
}

export function edgeLength(geo: EditorGeometry, edge: EdgeId): number {
  const segment = edgeSegment(geo, edge);
  if (segment) return Math.hypot(segment[1][0] - segment[0][0], segment[1][1] - segment[0][1]);
  const circle = geo.holes.find((h) => h.kind === 'circle' && h.edge === edge);
  return circle && circle.kind === 'circle' ? 2 * Math.PI * circle.r : 0;
}

export function polygonHole(geo: EditorGeometry, id: string): PolygonSpec | null {
  const hole = geo.holes.find((h) => h.id === id);
  return hole?.kind === 'polygon' ? hole : null;
}

/** The polygon (outline or hole) that owns a straight edge. */
export function polygonOwning(geo: EditorGeometry, edge: EdgeId): { hole?: string; polygon: PolygonSpec } | null {
  if (geo.outline.edges.includes(edge)) return { polygon: geo.outline };
  for (const hole of geo.holes) {
    if (hole.kind === 'polygon' && hole.edges.includes(edge)) return { hole: hole.id, polygon: hole };
  }
  return null;
}

/** Twice the signed area of a polygon: positive when counter-clockwise. */
export function signedArea2(points: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

function mapPolygon(geo: EditorGeometry, hole: string | undefined, f: (p: PolygonSpec) => PolygonSpec): EditorGeometry {
  if (!hole) return { ...geo, outline: f(geo.outline) };
  return {
    ...geo,
    holes: geo.holes.map((h) => (h.id === hole && h.kind === 'polygon' ? { ...h, ...f(h) } : h)),
  };
}

function dropConditions(conditions: Record<EdgeId, EdgeCondition>, edges: readonly EdgeId[]) {
  const next = { ...conditions };
  for (const e of edges) delete next[e];
  return next;
}

const copy = (p: Point): Point => [p[0], p[1]];
