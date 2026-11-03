// Canvas2D drawing for the geometry editor: grid, part, edges coloured by
// condition, support and load glyphs, handles, and the in-progress draft.

import type { Hit, Selection } from '../editor/interaction';
import { type EdgeId, type EditorGeometry, type Point, signedArea2 } from '../editor/model';
import { drawLoad, drawSupport, screenPolyline } from './overlay';
import { screenToWorld, type View, worldToScreen } from './view';

export type Draft =
  | { kind: 'polygon'; points: Point[]; cursor: Point | null; closable: boolean }
  | { kind: 'circle'; centre: Point; r: number }
  | null;

export interface EditorColors {
  background: string;
  grid: string;
  gridMajor: string;
  axis: string;
  fill: string;
  edge: string;
  support: string;
  load: string;
  selected: string;
  label: string;
}

export interface EditorDrawParams {
  view: View;
  geo: EditorGeometry;
  selection: Selection;
  hover: Hit | null;
  draft: Draft;
  gridStep: number;
  colors: EditorColors;
}

/** Each edge of the geometry as a world polyline, oriented with the material on its left. */
export function edgePolylines(geo: EditorGeometry): { edge: EdgeId; points: Point[] }[] {
  const out: { edge: EdgeId; points: Point[] }[] = [];
  const polygon = (points: Point[], edges: EdgeId[], materialInside: boolean) => {
    // Outline: counter-clockwise keeps the material on the left. Holes: clockwise.
    const ccw = signedArea2(points) > 0;
    const forward = ccw === materialInside;
    edges.forEach((edge, i) => {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      out.push({ edge, points: forward ? [a, b] : [b, a] });
    });
  };
  polygon(geo.outline.points, geo.outline.edges, true);
  for (const h of geo.holes) {
    if (h.kind === 'polygon') {
      polygon(h.points, h.edges, false);
    } else {
      const n = 96;
      const pts: Point[] = [];
      for (let k = 0; k <= n; k++) {
        const t = (-2 * Math.PI * k) / n; // clockwise
        pts.push([h.cx + h.r * Math.cos(t), h.cy + h.r * Math.sin(t)]);
      }
      out.push({ edge: h.edge, points: pts });
    }
  }
  return out;
}

export function drawEditor(ctx: CanvasRenderingContext2D, p: EditorDrawParams): void {
  const { view, geo, colors } = p;
  ctx.clearRect(0, 0, view.width, view.height);
  drawGrid(ctx, view, p.gridStep, colors);

  // Part, with holes cut out (even–odd fill).
  if (geo.outline.points.length >= 3) {
    ctx.beginPath();
    tracePolygon(ctx, view, geo.outline.points);
    for (const h of geo.holes) {
      if (h.kind === 'polygon') tracePolygon(ctx, view, h.points);
      else {
        const [x, y] = worldToScreen(view, h.cx, h.cy);
        ctx.moveTo(x + h.r * view.zoom, y);
        ctx.arc(x, y, h.r * view.zoom, 0, 2 * Math.PI);
      }
    }
    ctx.fillStyle = colors.fill;
    ctx.fill('evenodd');
  }

  // Edges, then their support and load glyphs.
  const selectedEdge = p.selection?.kind === 'edge' ? p.selection.edge : null;
  const hoverEdge = p.hover && (p.hover.kind === 'edge' || p.hover.kind === 'circle-edge') ? p.hover.edge : null;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const { edge, points } of edgePolylines(geo)) {
    const condition = geo.conditions[edge];
    ctx.beginPath();
    tracePolyline(ctx, view, points);
    ctx.strokeStyle = condition?.load ? colors.load : condition?.support ? colors.support : colors.edge;
    ctx.lineWidth = condition ? 2.5 : 1.5;
    ctx.stroke();
    if (edge === selectedEdge || edge === hoverEdge) {
      ctx.strokeStyle = colors.selected;
      ctx.globalAlpha = edge === selectedEdge ? 0.9 : 0.45;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (condition?.support) drawSupport(ctx, screenPolyline(view, points), { kind: condition.support }, colors.support);
    if (condition?.load) drawLoad(ctx, screenPolyline(view, points), condition.load, colors);
  }

  // Vertex handles and circle centres.
  const handles: { hole?: string; points: Point[] }[] = [
    { points: geo.outline.points },
    ...geo.holes.flatMap((h) => (h.kind === 'polygon' ? [{ hole: h.id, points: h.points }] : [])),
  ];
  for (const { hole, points } of handles) {
    points.forEach((q, index) => {
      const selected = p.selection?.kind === 'vertex' && p.selection.hole === hole && p.selection.index === index;
      const hovered = p.hover?.kind === 'vertex' && p.hover.ref.hole === hole && p.hover.ref.index === index;
      square(ctx, worldToScreen(view, q[0], q[1]), selected ? colors.selected : colors.edge, selected || hovered, colors.background);
    });
  }
  for (const h of geo.holes) {
    if (h.kind !== 'circle') continue;
    const selected = p.selection?.kind === 'hole' && p.selection.hole === h.id;
    const [x, y] = worldToScreen(view, h.cx, h.cy);
    ctx.strokeStyle = selected ? colors.selected : colors.edge;
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.beginPath();
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x + 5, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.stroke();
  }

  drawDraft(ctx, view, p.draft, colors);
}

function drawGrid(ctx: CanvasRenderingContext2D, view: View, step: number, colors: EditorColors): void {
  const [x0, y1] = screenToWorld(view, 0, 0);
  const [x1, y0] = screenToWorld(view, view.width, view.height);
  const lines = (from: number, to: number, f: (v: number) => void) => {
    for (let k = Math.ceil(from / step); k * step <= to; k++) f(k);
  };
  ctx.lineWidth = 1;
  lines(x0, x1, (k) => {
    const [sx] = worldToScreen(view, k * step, 0);
    ctx.strokeStyle = k === 0 ? colors.axis : k % 5 === 0 ? colors.gridMajor : colors.grid;
    ctx.beginPath();
    ctx.moveTo(Math.round(sx) + 0.5, 0);
    ctx.lineTo(Math.round(sx) + 0.5, view.height);
    ctx.stroke();
  });
  lines(y0, y1, (k) => {
    const [, sy] = worldToScreen(view, 0, k * step);
    ctx.strokeStyle = k === 0 ? colors.axis : k % 5 === 0 ? colors.gridMajor : colors.grid;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(sy) + 0.5);
    ctx.lineTo(view.width, Math.round(sy) + 0.5);
    ctx.stroke();
  });
}

function drawDraft(ctx: CanvasRenderingContext2D, view: View, draft: Draft, colors: EditorColors): void {
  if (!draft) return;
  ctx.strokeStyle = colors.selected;
  ctx.lineWidth = 1.5;
  if (draft.kind === 'circle') {
    const [x, y] = worldToScreen(view, draft.centre[0], draft.centre[1]);
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(draft.r * view.zoom, 1), 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  const pts = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
  ctx.beginPath();
  tracePolyline(ctx, view, pts);
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  draft.points.forEach((q, i) => {
    const s = worldToScreen(view, q[0], q[1]);
    square(ctx, s, colors.selected, i === 0 && draft.closable, colors.background);
    if (i === 0 && draft.closable) {
      ctx.beginPath();
      ctx.arc(s[0], s[1], 9, 0, 2 * Math.PI);
      ctx.stroke();
    }
  });
}

function tracePolygon(ctx: CanvasRenderingContext2D, view: View, points: readonly Point[]): void {
  tracePolyline(ctx, view, points);
  ctx.closePath();
}

function tracePolyline(ctx: CanvasRenderingContext2D, view: View, points: readonly Point[]): void {
  points.forEach(([x, y], i) => {
    const [sx, sy] = worldToScreen(view, x, y);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
}

function square(
  ctx: CanvasRenderingContext2D,
  [x, y]: [number, number],
  color: string,
  filled: boolean,
  background: string,
): void {
  const s = 7;
  ctx.fillStyle = filled ? color : background;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.fillRect(x - s / 2, y - s / 2, s, s);
  ctx.strokeRect(x - s / 2, y - s / 2, s, s);
}
