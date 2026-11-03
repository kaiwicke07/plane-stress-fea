// Keeps the user's part across reloads, in this browser only. Storage can be
// unavailable (private windows, blocked site data), so every access is guarded
// and the app works without it.

import type { SupportKind } from '../model/spec';
import type { EdgeCondition, EditorGeometry, HoleSpec, LoadSpec, Point } from './model';

const KEY = 'plane-stress-fea.editor.v1';

export function loadGeometry(): EditorGeometry | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseGeometry(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveGeometry(geo: EditorGeometry): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(geo));
  } catch {
    // Storage full or blocked: the part simply isn't remembered.
  }
}

/** Validates untrusted JSON into a geometry, or returns null. */
export function parseGeometry(value: unknown): EditorGeometry | null {
  if (!isObject(value)) return null;
  const outline = parsePolygon(value.outline);
  if (!outline || !Array.isArray(value.holes) || !isObject(value.conditions)) return null;

  const holes: HoleSpec[] = [];
  for (const h of value.holes) {
    if (!isObject(h) || typeof h.id !== 'string') return null;
    if (h.kind === 'circle') {
      if (![h.cx, h.cy, h.r].every(isFiniteNumber) || typeof h.edge !== 'string') return null;
      holes.push({ id: h.id, kind: 'circle', cx: h.cx as number, cy: h.cy as number, r: h.r as number, edge: h.edge });
    } else if (h.kind === 'polygon') {
      const poly = parsePolygon(h);
      if (!poly) return null;
      holes.push({ id: h.id, kind: 'polygon', ...poly });
    } else {
      return null;
    }
  }

  const conditions: Record<string, EdgeCondition> = {};
  for (const [edge, c] of Object.entries(value.conditions)) {
    const condition = parseCondition(c);
    if (!condition) return null;
    conditions[edge] = condition;
  }

  // Never hand out an ID that is already in use, whatever the stored counter says.
  const used = [...outline.edges, ...holes.flatMap((h) => (h.kind === 'circle' ? [h.id, h.edge] : [h.id, ...h.edges]))];
  const highest = Math.max(0, ...used.map((id) => Number(id.slice(1))).filter(Number.isFinite));
  const nextId = Math.max(isFiniteNumber(value.nextId) ? (value.nextId as number) : 1, highest + 1);
  return { outline, holes, conditions, nextId };
}

function parsePolygon(value: unknown): { points: Point[]; edges: string[] } | null {
  if (!isObject(value) || !Array.isArray(value.points) || !Array.isArray(value.edges)) return null;
  const points: Point[] = [];
  for (const p of value.points) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(isFiniteNumber)) return null;
    points.push([p[0], p[1]]);
  }
  if (value.edges.length !== points.length || !value.edges.every((e) => typeof e === 'string')) return null;
  return { points, edges: value.edges as string[] };
}

const SUPPORTS: readonly SupportKind[] = ['fixed', 'roller-x', 'roller-y'];

function parseCondition(value: unknown): EdgeCondition | null {
  if (!isObject(value)) return null;
  const condition: EdgeCondition = {};
  if (value.support !== undefined) {
    if (!SUPPORTS.includes(value.support as SupportKind)) return null;
    condition.support = value.support as SupportKind;
  }
  if (value.load !== undefined) {
    const load = parseLoad(value.load);
    if (!load) return null;
    condition.load = load;
  }
  return condition;
}

function parseLoad(value: unknown): LoadSpec | null {
  if (!isObject(value)) return null;
  if (value.kind === 'force' && isFiniteNumber(value.fx) && isFiniteNumber(value.fy)) {
    return { kind: 'force', fx: value.fx, fy: value.fy };
  }
  if (value.kind === 'pressure' && isFiniteNumber(value.p)) return { kind: 'pressure', p: value.p };
  if (value.kind === 'traction' && isFiniteNumber(value.tx) && isFiniteNumber(value.ty)) {
    return { kind: 'traction', tx: value.tx, ty: value.ty };
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
