// Canvas2D overlay: outlines, support glyphs, load arrows and the probe marker.
// Drawn on top of the WebGL field in CSS pixels.

import { edgesWithTag, type TaggedMesh } from '../mesh/tagged-mesh';
import type { EdgeLoad, EdgeSupport } from '../model/spec';
import { type View, worldToScreen } from './view';

export interface OverlayColors {
  outline: string;
  ghost: string;
  support: string;
  load: string;
  label: string;
}

export interface OverlayParams {
  view: View;
  mesh: TaggedMesh;
  /** Deformed node positions (already scaled). */
  deformed: Float64Array;
  showUndeformed: boolean;
  supports: readonly EdgeSupport[];
  loads: readonly EdgeLoad[];
  /** Probe point in deformed world coordinates. */
  probe: [number, number] | null;
  colors: OverlayColors;
}

type Vec = [number, number];

/** A geometry edge as a screen-space polyline with outward normals per segment. */
interface ScreenEdge {
  points: Vec[];
  normals: Vec[];
  length: number;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, p: OverlayParams): void {
  const { view, mesh, deformed, colors } = p;
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (p.showUndeformed) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    strokeBoundary(ctx, view, mesh, mesh.nodes, colors.ghost, 1);
    ctx.restore();
  }
  strokeBoundary(ctx, view, mesh, deformed, colors.outline, 1);

  for (const support of p.supports) drawSupport(ctx, screenEdge(view, mesh, deformed, support.edge), support, colors.support);
  for (const load of p.loads) drawLoad(ctx, screenEdge(view, mesh, deformed, load.edge), load, colors);

  if (p.probe) {
    const [x, y] = worldToScreen(view, p.probe[0], p.probe[1]);
    ctx.strokeStyle = colors.label;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

function strokeBoundary(
  ctx: CanvasRenderingContext2D,
  view: View,
  mesh: TaggedMesh,
  positions: Float64Array,
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  const edges = mesh.boundaryEdges;
  for (let k = 0; k < edges.length; k += 2) {
    const [ax, ay] = worldToScreen(view, positions[2 * edges[k]], positions[2 * edges[k] + 1]);
    const [bx, by] = worldToScreen(view, positions[2 * edges[k + 1]], positions[2 * edges[k + 1] + 1]);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
}

function screenEdge(view: View, mesh: TaggedMesh, positions: Float64Array, tag: number): ScreenEdge {
  const edges = edgesWithTag(mesh, tag);
  const points: Vec[] = [];
  const normals: Vec[] = [];
  let length = 0;
  edges.forEach(([a, b], k) => {
    const pa = worldToScreen(view, positions[2 * a], positions[2 * a + 1]);
    const pb = worldToScreen(view, positions[2 * b], positions[2 * b + 1]);
    if (k === 0) points.push(pa);
    points.push(pb);
    const [dx, dy] = [pb[0] - pa[0], pb[1] - pa[1]];
    const l = Math.hypot(dx, dy) || 1;
    length += l;
    // World outward normal is (Δy, −Δx); the screen flips y, so it becomes (−Δy, Δx).
    normals.push([-dy / l, dx / l]);
  });
  return { points, normals, length };
}

/** Evenly spaced samples along the polyline: position, tangent, normal and arc-length fraction. */
function samples(edge: ScreenEdge, spacing: number): { at: Vec; tangent: Vec; normal: Vec; s: number }[] {
  const out: { at: Vec; tangent: Vec; normal: Vec; s: number }[] = [];
  if (edge.length === 0) return out;
  const count = Math.max(1, Math.round(edge.length / spacing));
  const step = edge.length / count;
  let target = step / 2;
  let walked = 0;
  for (let k = 0; k < edge.normals.length; k++) {
    const [a, b] = [edge.points[k], edge.points[k + 1]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (target <= walked + l && out.length < count) {
      const f = l > 0 ? (target - walked) / l : 0;
      out.push({
        at: [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])],
        tangent: [(b[0] - a[0]) / (l || 1), (b[1] - a[1]) / (l || 1)],
        normal: edge.normals[k],
        s: target / edge.length,
      });
      target += step;
    }
    walked += l;
  }
  return out;
}

function drawSupport(ctx: CanvasRenderingContext2D, edge: ScreenEdge, support: EdgeSupport, color: string): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (support.kind === 'fixed') {
    // Hatched wall on the outside of the edge.
    edge.points.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    for (const { at, tangent, normal } of samples(edge, 9)) {
      ctx.moveTo(at[0], at[1]);
      ctx.lineTo(at[0] + 8 * normal[0] - 5 * tangent[0], at[1] + 8 * normal[1] - 5 * tangent[1]);
    }
    ctx.stroke();
    return;
  }
  // Roller: small wheels between the edge and an offset ground line.
  for (const { at, normal } of samples(edge, 14)) {
    ctx.moveTo(at[0] + 4 * normal[0] + 3.5, at[1] + 4 * normal[1]);
    ctx.arc(at[0] + 4 * normal[0], at[1] + 4 * normal[1], 3.5, 0, 2 * Math.PI);
  }
  ctx.stroke();
  ctx.beginPath();
  edge.points.forEach(([x, y], k) => {
    const n = edge.normals[Math.min(k, edge.normals.length - 1)];
    const [gx, gy] = [x + 9 * n[0], y + 9 * n[1]];
    if (k === 0) ctx.moveTo(gx, gy);
    else ctx.lineTo(gx, gy);
  });
  ctx.stroke();
}

function loadVector(load: EdgeLoad, normal: Vec): Vec {
  // Screen y is down, so flip the y component of world vectors.
  switch (load.kind) {
    case 'force':
    case 'parabolic-shear':
      return [load.fx, -load.fy];
    case 'traction':
      return [load.tx, -load.ty];
    case 'pressure':
      return [-load.p * normal[0], -load.p * normal[1]];
  }
}

function loadLabel(load: EdgeLoad): string {
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3));
  switch (load.kind) {
    case 'force':
    case 'parabolic-shear':
      return `${fmt(Math.hypot(load.fx, load.fy))} N`;
    case 'traction':
      return `${fmt(Math.hypot(load.tx, load.ty))} MPa`;
    case 'pressure':
      return `${fmt(load.p)} MPa`;
  }
}

function drawLoad(ctx: CanvasRenderingContext2D, edge: ScreenEdge, load: EdgeLoad, colors: OverlayColors): void {
  const midNormal = edge.normals[Math.floor(edge.normals.length / 2)] ?? [1, 0];
  const v = loadVector(load, midNormal);
  const magnitude = Math.hypot(v[0], v[1]);
  if (magnitude === 0 || edge.normals.length === 0) return;
  const d: Vec = [v[0] / magnitude, v[1] / magnitude];

  ctx.strokeStyle = colors.load;
  ctx.fillStyle = colors.load;
  ctx.lineWidth = 2;

  const normalPart = d[0] * midNormal[0] + d[1] * midNormal[1];
  let labelAt: Vec;
  if (Math.abs(normalPart) < 0.5) {
    // Mostly tangential (shear): one resultant arrow beside the edge midpoint.
    const mid = samples(edge, edge.length)[0].at;
    const base: Vec = [mid[0] + 18 * midNormal[0], mid[1] + 18 * midNormal[1]];
    const half = 28;
    const tail: Vec = [base[0] - half * d[0], base[1] - half * d[1]];
    arrow(ctx, tail, [base[0] + half * d[0], base[1] + half * d[1]]);
    // Label beyond the tail, where it cannot run off the side of the part.
    labelAt = [tail[0] - 12 * d[0], tail[1] - 12 * d[1]];
    ctx.textAlign = 'center';
  } else {
    // Normal loads: a row of arrows, pushing onto or pulling away from the surface.
    const pulling = normalPart > 0;
    for (const { at, normal } of samples(edge, 22)) {
      const length = 26;
      if (pulling) {
        const tail: Vec = [at[0] + 4 * normal[0], at[1] + 4 * normal[1]];
        arrow(ctx, tail, [tail[0] + length * d[0], tail[1] + length * d[1]]);
      } else {
        const tip: Vec = [at[0] + 4 * normal[0], at[1] + 4 * normal[1]];
        arrow(ctx, [tip[0] - length * d[0], tip[1] - length * d[1]], tip);
      }
    }
    const mid = samples(edge, edge.length)[0].at;
    labelAt = [mid[0] + 40 * midNormal[0], mid[1] + 40 * midNormal[1]];
    ctx.textAlign = midNormal[0] < -0.5 ? 'right' : midNormal[0] > 0.5 ? 'left' : 'center';
  }

  ctx.fillStyle = colors.label;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(loadLabel(load), labelAt[0], labelAt[1]);
}

function arrow(ctx: CanvasRenderingContext2D, from: Vec, to: Vec): void {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const l = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / l, dy / l];
  const head = 7;
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0] - head * ux, to[1] - head * uy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - head * ux - (head / 2) * uy, to[1] - head * uy + (head / 2) * ux);
  ctx.lineTo(to[0] - head * ux + (head / 2) * uy, to[1] - head * uy - (head / 2) * ux);
  ctx.closePath();
  ctx.fill();
}
