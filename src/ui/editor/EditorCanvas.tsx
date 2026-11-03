import { useEffect, useMemo, useRef, useState } from 'react';
import { closestOnSegment, gridStep, type Hit, hitTest, type Selection, snapPoint } from '../../editor/interaction';
import {
  addCircleHole,
  addPolygonHole,
  type EditorGeometry,
  edgeSegment,
  insertVertex,
  moveVertex,
  type Point,
  setOutline,
  updateCircle,
} from '../../editor/model';
import { type Tool, toolHint } from '../../editor/tools';
import { type Draft, drawEditor, type EditorColors } from '../../render/editor-draw';
import { type Bounds, fitView, panBy, screenToWorld, type View, zoomAt } from '../../render/view';
import { formatNumber } from '../format';

interface EditorCanvasProps {
  geometry: EditorGeometry;
  selection: Selection;
  tool: Tool;
  snap: boolean;
  /** Changes when the geometry is replaced wholesale (a template), to re-fit the view. */
  fitKey: number;
  onChange: (next: EditorGeometry, commit: boolean) => void;
  /** Called when a drag begins, so the drag undoes as one step. */
  onCheckpoint: () => void;
  onSelect: (selection: Selection) => void;
  onToolDone: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

type Camera = Pick<View, 'cx' | 'cy' | 'zoom'>;

type Drag =
  | { kind: 'pan'; last: [number, number] }
  | { kind: 'vertex'; hole?: string; index: number }
  | { kind: 'circle'; hole: string; offset: Point }
  | { kind: 'radius'; hole: string }
  | { kind: 'circle-draft'; centre: Point };

const HIT_PX = 8;
const KEY_PAN = 40;
const EMPTY_BOUNDS: Bounds = { minX: -10, minY: -10, maxX: 110, maxY: 60 };

function geometryBounds(geo: EditorGeometry): Bounds {
  const pts = geo.outline.points;
  if (pts.length === 0) return EMPTY_BOUNDS;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function EditorCanvas(props: EditorCanvasProps) {
  const { geometry: geo, selection, tool, snap, fitKey } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorsRef = useRef<EditorColors | null>(null);
  const drag = useRef<Drag | null>(null);

  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });
  const [camera, setCamera] = useState<Camera | null>(null);
  const [fittedKey, setFittedKey] = useState<number | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [hover, setHover] = useState<Hit | null>(null);
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [circleDraft, setCircleDraft] = useState<{ centre: Point; r: number } | null>(null);

  // Fit on first layout and whenever a new geometry is loaded.
  if (size.width > 0 && fittedKey !== fitKey) {
    setFittedKey(fitKey);
    setCamera(fitView(geometryBounds(geo), size.width, size.height, 0.15));
  }
  // Abandon a half-drawn polygon when switching tools.
  const [draftTool, setDraftTool] = useState(tool);
  if (draftTool !== tool) {
    setDraftTool(tool);
    setDraftPoints([]);
    setCircleDraft(null);
  }

  const view: View | null = camera ? { ...camera, width: size.width, height: size.height } : null;
  const step = view ? gridStep(view.zoom) : 1;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
      }
      setSize({ width, height, dpr });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015));
      setCamera((c) => c && zoomAt({ ...c, width: rect.width, height: rect.height }, event.clientX - rect.left, event.clientY - rect.top, factor));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  const closable = (tool === 'outline' || tool === 'polygon-hole') && draftPoints.length >= 3;
  const draft = useMemo<Draft>(() => {
    if (circleDraft) return { kind: 'circle', centre: circleDraft.centre, r: circleDraft.r };
    if (draftPoints.length > 0) return { kind: 'polygon', points: draftPoints, cursor, closable };
    return null;
  }, [circleDraft, draftPoints, cursor, closable]);

  const { width, height, dpr } = size;
  const { cx, cy, zoom } = camera ?? { cx: 0, cy: 0, zoom: 0 };
  useEffect(() => {
    if (zoom === 0 || width === 0) return;
    const frame = requestAnimationFrame(() => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx || !containerRef.current) return;
      colorsRef.current ??= readColors(containerRef.current);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawEditor(ctx, {
        view: { cx, cy, zoom, width, height },
        geo,
        selection,
        hover,
        draft,
        gridStep: gridStep(zoom),
        colors: colorsRef.current,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [cx, cy, zoom, width, height, dpr, geo, selection, hover, draft]);

  const local = (event: React.PointerEvent | React.MouseEvent): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const toWorld = (s: [number, number]): Point => (view ? screenToWorld(view, s[0], s[1]) : [0, 0]);
  const snapped = (p: Point): Point => (snap ? snapPoint(p, step) : p);
  const tolerance = view ? HIT_PX / view.zoom : 1;

  const fit = () => size.width > 0 && setCamera(fitView(geometryBounds(geo), size.width, size.height, 0.15));

  const closeDraft = () => {
    if (draftPoints.length < 3) return;
    props.onChange(tool === 'outline' ? setOutline(geo, draftPoints) : addPolygonHole(geo, draftPoints), true);
    setDraftPoints([]);
    props.onToolDone();
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || !view) return;
    containerRef.current?.focus();
    const s = local(event);
    const world = toWorld(s);
    const p = snapped(world);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'outline' || tool === 'polygon-hole') {
      const first = draftPoints[0];
      if (closable && first && Math.hypot(first[0] - world[0], first[1] - world[1]) <= tolerance) closeDraft();
      else setDraftPoints([...draftPoints, p]);
      return;
    }
    if (tool === 'circle-hole') {
      drag.current = { kind: 'circle-draft', centre: p };
      setCircleDraft({ centre: p, r: 0 });
      return;
    }

    const hit = hitTest(geo, world, tolerance);
    if (!hit) {
      props.onSelect(null);
      drag.current = { kind: 'pan', last: s };
    } else if (hit.kind === 'vertex') {
      props.onSelect({ kind: 'vertex', hole: hit.ref.hole, index: hit.ref.index });
      props.onCheckpoint();
      drag.current = { kind: 'vertex', ...hit.ref };
    } else if (hit.kind === 'circle-centre') {
      const hole = geo.holes.find((h) => h.id === hit.hole);
      props.onSelect({ kind: 'hole', hole: hit.hole });
      props.onCheckpoint();
      if (hole?.kind === 'circle') drag.current = { kind: 'circle', hole: hit.hole, offset: [world[0] - hole.cx, world[1] - hole.cy] };
    } else if (hit.kind === 'circle-edge') {
      props.onSelect({ kind: 'edge', edge: hit.edge });
      props.onCheckpoint();
      drag.current = { kind: 'radius', hole: hit.hole };
    } else {
      props.onSelect({ kind: 'edge', edge: hit.edge });
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!view) return;
    const s = local(event);
    const world = toWorld(s);
    setCursor(snapped(world));
    const d = drag.current;
    if (!d) {
      if (tool === 'select' && event.pointerType === 'mouse') setHover(hitTest(geo, world, tolerance));
      return;
    }
    switch (d.kind) {
      case 'pan':
        setCamera(panBy(view, s[0] - d.last[0], s[1] - d.last[1]));
        drag.current = { kind: 'pan', last: s };
        break;
      case 'vertex':
        props.onChange(moveVertex(geo, d, snapped(world)), false);
        break;
      case 'circle': {
        const [x, y] = snapped([world[0] - d.offset[0], world[1] - d.offset[1]]);
        props.onChange(updateCircle(geo, d.hole, { cx: x, cy: y }), false);
        break;
      }
      case 'radius': {
        const hole = geo.holes.find((h) => h.id === d.hole);
        if (hole?.kind !== 'circle') break;
        const r = radius([hole.cx, hole.cy], world);
        props.onChange(updateCircle(geo, d.hole, { r }), false);
        break;
      }
      case 'circle-draft':
        setCircleDraft({ centre: d.centre, r: radius(d.centre, world) });
        break;
    }
  };

  /**
   * Radius from a drag: snapped to whole grid steps (at least one) when
   * snapping, otherwise exact. A click without a drag gives one grid step.
   */
  const radius = (centre: Point, world: Point) => {
    const r = Math.hypot(world[0] - centre[0], world[1] - centre[1]);
    if (snap) return Math.max(step, Math.round(r / step) * step);
    return r * (view?.zoom ?? 1) < 2 ? step : r;
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'circle-draft') {
      // Take the radius from this event, not from state: a quick drag can end
      // before React has rendered the last pointer move.
      const r = radius(d.centre, toWorld(local(event)));
      const next = addCircleHole(geo, d.centre[0], d.centre[1], r);
      const hole = next.holes[next.holes.length - 1];
      props.onChange(next, true);
      if (hole.kind === 'circle') props.onSelect({ kind: 'edge', edge: hole.edge });
      setCircleDraft(null);
      props.onToolDone();
    }
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    if (tool !== 'select' || !view) return;
    const world = toWorld(local(event));
    const hit = hitTest(geo, world, tolerance);
    if (hit?.kind !== 'edge') {
      if (!hit) fit();
      return;
    }
    const segment = edgeSegment(geo, hit.edge);
    if (!segment) return;
    // Snap, then project back onto the edge so the new corner keeps the shape.
    const { at } = closestOnSegment(segment[0], segment[1], snapped(world));
    props.onChange(insertVertex(geo, hit.edge, at), true);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) props.onRedo();
      else props.onUndo();
      return;
    }
    if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      props.onRedo();
      return;
    }
    if (!view) return;
    const zoomCentre = (f: number) => setCamera(zoomAt(view, view.width / 2, view.height / 2, f));
    const actions: Record<string, () => void> = {
      Escape: () => (draftPoints.length > 0 || circleDraft ? (setDraftPoints([]), setCircleDraft(null)) : props.onSelect(null)),
      Enter: closeDraft,
      Backspace: () => (draftPoints.length > 0 ? setDraftPoints(draftPoints.slice(0, -1)) : props.onDelete()),
      Delete: props.onDelete,
      ArrowLeft: () => setCamera(panBy(view, KEY_PAN, 0)),
      ArrowRight: () => setCamera(panBy(view, -KEY_PAN, 0)),
      ArrowUp: () => setCamera(panBy(view, 0, KEY_PAN)),
      ArrowDown: () => setCamera(panBy(view, 0, -KEY_PAN)),
      '+': () => zoomCentre(1.25),
      '=': () => zoomCentre(1.25),
      '-': () => zoomCentre(0.8),
      '0': fit,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  return (
    <div
      ref={containerRef}
      className={`editor tool-${tool}`}
      tabIndex={0}
      role="region"
      aria-label="Geometry editor"
      aria-describedby="editor-hint"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setHover(null);
        setCursor(null);
      }}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className="viewport-canvas" />
      <div className="editor-status">
        <span id="editor-hint">{toolHint(tool)}</span>
        <span className="editor-coords">
          {cursor ? `x ${cursor[0].toFixed(digits)}, y ${cursor[1].toFixed(digits)} mm` : ''} · grid {formatNumber(step)} mm
        </span>
      </div>
    </div>
  );
}

function readColors(element: HTMLElement): EditorColors {
  const css = getComputedStyle(element);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: v('--bg'),
    grid: v('--grid'),
    gridMajor: v('--grid-major'),
    axis: v('--text-muted'),
    fill: v('--editor-fill'),
    edge: v('--text-muted'),
    support: v('--viz-support'),
    load: v('--accent'),
    selected: v('--text'),
    label: v('--text'),
  };
}
