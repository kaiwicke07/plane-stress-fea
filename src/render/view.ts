// 2D camera: world (mm, y up) ↔ screen (CSS px, y down).

export interface View {
  /** World point at the centre of the viewport. */
  cx: number;
  cy: number;
  /** Screen pixels per mm. */
  zoom: number;
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Float64Array): Bounds {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i < points.length; i += 2) {
    b.minX = Math.min(b.minX, points[i]);
    b.maxX = Math.max(b.maxX, points[i]);
    b.minY = Math.min(b.minY, points[i + 1]);
    b.maxY = Math.max(b.maxY, points[i + 1]);
  }
  return b;
}

/** Fits `bounds` in the viewport, leaving `padding` (fraction of the viewport) on each side. */
export function fitView(bounds: Bounds, width: number, height: number, padding = 0.12): View {
  const w = Math.max(bounds.maxX - bounds.minX, 1e-9);
  const h = Math.max(bounds.maxY - bounds.minY, 1e-9);
  const usable = 1 - 2 * padding;
  const zoom = Math.min((width * usable) / w, (height * usable) / h);
  return { cx: (bounds.minX + bounds.maxX) / 2, cy: (bounds.minY + bounds.maxY) / 2, zoom, width, height };
}

export function worldToScreen(view: View, x: number, y: number): [number, number] {
  return [(x - view.cx) * view.zoom + view.width / 2, view.height / 2 - (y - view.cy) * view.zoom];
}

export function screenToWorld(view: View, sx: number, sy: number): [number, number] {
  return [(sx - view.width / 2) / view.zoom + view.cx, (view.height / 2 - sy) / view.zoom + view.cy];
}

/** Zooms by `factor`, keeping the world point under screen point (sx, sy) fixed. */
export function zoomAt(view: View, sx: number, sy: number, factor: number): View {
  const [wx, wy] = screenToWorld(view, sx, sy);
  const zoom = view.zoom * factor;
  // Solve for the centre that puts (wx, wy) back at (sx, sy).
  return {
    ...view,
    zoom,
    cx: wx - (sx - view.width / 2) / zoom,
    cy: wy - (view.height / 2 - sy) / zoom,
  };
}

/** Moves the view so the content follows a drag of (dx, dy) screen pixels. */
export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, cx: view.cx - dx / view.zoom, cy: view.cy + dy / view.zoom };
}

/**
 * World → clip-space transform as a column-major 3×3 matrix, for WebGL.
 * clipX = 2·zoom/width·(x − cx), clipY = 2·zoom/height·(y − cy).
 */
export function clipMatrix(view: View): Float32Array {
  const sx = (2 * view.zoom) / view.width;
  const sy = (2 * view.zoom) / view.height;
  return new Float32Array([sx, 0, 0, 0, sy, 0, -sx * view.cx, -sy * view.cy, 1]);
}
