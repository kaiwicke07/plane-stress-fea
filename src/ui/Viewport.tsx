import { useEffect, useMemo, useRef, useState } from 'react';
import { DIVERGING_STOPS, HEAT_STOPS } from '../render/colormap';
import { FieldRenderer } from '../render/field-renderer';
import { elementValues, type FieldId, fieldById, fieldRange, nodalValues, type StressDisplay } from '../render/fields';
import { drawOverlay, type OverlayColors } from '../render/overlay';
import { deformedPositions, locate } from '../render/probe';
import { type Bounds, boundsOf, fitView, panBy, screenToWorld, type View, zoomAt } from '../render/view';
import type { SolveResult } from '../worker/job';
import { formatWithUnit } from './format';
import { Legend } from './Legend';

export interface DisplaySettings {
  field: FieldId;
  stress: StressDisplay;
  bands: number;
  showMesh: boolean;
  showUndeformed: boolean;
}

interface ViewportProps {
  result: SolveResult | null;
  display: DisplaySettings;
  deformationScale: number;
  busy: boolean;
  error: string | null;
}

/** Camera position; the viewport size comes from layout. */
type Camera = Pick<View, 'cx' | 'cy' | 'zoom'>;

interface Probe {
  sx: number;
  sy: number;
  world: [number, number];
  value: number;
  ux: number;
  uy: number;
}

const KEY_PAN = 40;

function sameBounds(a: Bounds, b: Bounds): boolean {
  return [a.minX - b.minX, a.minY - b.minY, a.maxX - b.maxX, a.maxY - b.maxY].every((d) => Math.abs(d) < 1e-9);
}

export function Viewport({ result, display, deformationScale, busy, error }: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FieldRenderer | null>(null);
  const colorsRef = useRef<OverlayColors | null>(null);
  const pointers = useRef(new Map<number, [number, number]>());

  const [webgl2] = useState(() => Boolean(document.createElement('canvas').getContext('webgl2')));
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });
  const [camera, setCamera] = useState<Camera | null>(null);
  const [fittedBounds, setFittedBounds] = useState<Bounds | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);

  const field = fieldById(display.field);
  const stops = field.diverging ? DIVERGING_STOPS : HEAT_STOPS;
  const bounds = useMemo(() => (result ? boundsOf(result.mesh.nodes) : null), [result]);

  // Fit the camera when the part's extent changes (not when it is only re-meshed).
  // Adjusting state during render avoids an extra effect pass.
  if (bounds && size.width > 0 && (!fittedBounds || !sameBounds(bounds, fittedBounds))) {
    setFittedBounds(bounds);
    setCamera(fitView(bounds, size.width, size.height));
  }

  const view: View | null = camera ? { ...camera, width: size.width, height: size.height } : null;

  const fit = () => {
    if (bounds && size.width > 0) setCamera(fitView(bounds, size.width, size.height));
  };

  useEffect(() => {
    if (!webgl2 || !glCanvasRef.current) return;
    rendererRef.current = new FieldRenderer(glCanvasRef.current);
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [webgl2]);

  // Track the container size in CSS and device pixels, and size the canvases to match.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      for (const canvas of [glCanvasRef.current, overlayRef.current]) {
        if (!canvas) continue;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
      }
      setSize({ width, height, dpr });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (result) rendererRef.current?.setMesh(result.mesh, result.solution.displacements);
  }, [result]);

  const { values, range } = useMemo(() => {
    if (!result) return { values: new Float64Array(), range: [0, 1] as [number, number] };
    const vals =
      display.stress === 'element'
        ? elementValues(display.field, result.solution, result.mesh)
        : nodalValues(display.field, result.solution, display.stress);
    return { values: vals, range: fieldRange(vals, field.diverging) };
  }, [result, display.field, display.stress, field.diverging]);
  const perElement = display.stress === 'element';

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !result) return;
    renderer.setColormap(stops);
    renderer.setValues(values, perElement);
  }, [result, values, stops, perElement]);

  const deformed = useMemo(
    () => (result ? deformedPositions(result.mesh.nodes, result.solution.displacements, deformationScale) : null),
    [result, deformationScale],
  );

  // Draw whenever anything visible changes, at most once per frame.
  const { width, height, dpr } = size;
  const { cx, cy, zoom } = camera ?? { cx: 0, cy: 0, zoom: 0 };
  useEffect(() => {
    if (!result || !deformed || zoom === 0 || width === 0) return;
    const frameView: View = { cx, cy, zoom, width, height };
    const frame = requestAnimationFrame(() => {
      rendererRef.current?.draw({
        view: frameView,
        dpr,
        deformationScale,
        range,
        bands: display.bands,
        showMesh: display.showMesh,
      });
      const ctx = overlayRef.current?.getContext('2d');
      if (!ctx || !containerRef.current) return;
      colorsRef.current ??= readOverlayColors(containerRef.current);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawOverlay(ctx, {
        view: frameView,
        mesh: result.mesh,
        deformed,
        showUndeformed: display.showUndeformed,
        supports: result.supports,
        loads: result.loads,
        probe: probe?.world ?? null,
        colors: colorsRef.current,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [cx, cy, zoom, width, height, dpr, result, deformed, deformationScale, range, values, display, probe]);

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
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

  const updateCamera = (next: (v: View) => View) => {
    if (view) setCamera(next(view));
  };

  const updateProbe = (sx: number, sy: number) => {
    if (!view || !result || !deformed) return;
    const world = screenToWorld(view, sx, sy);
    const hit = locate(deformed, result.mesh.elements, world[0], world[1]);
    if (!hit) {
      setProbe(null);
      return;
    }
    const nodes = [0, 1, 2].map((k) => result.mesh.elements[3 * hit.element + k]);
    const u = result.solution.displacements;
    const interp = (f: (n: number) => number) => hit.weights.reduce((s, w, k) => s + w * f(nodes[k]), 0);
    setProbe({
      sx,
      sy,
      world,
      value: perElement ? values[hit.element] : interp((n) => values[n]),
      ux: interp((n) => u[2 * n]),
      uy: interp((n) => u[2 * n + 1]),
    });
  };

  const local = (event: React.PointerEvent): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    setProbe(null);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const p = local(event);
    const active = pointers.current;
    const previous = active.get(event.pointerId);
    if (!previous) {
      if (event.pointerType === 'mouse') updateProbe(p[0], p[1]);
      return;
    }
    if (active.size === 1) {
      updateCamera((v) => panBy(v, p[0] - previous[0], p[1] - previous[1]));
    } else if (active.size === 2) {
      // Pinch: zoom by the change in finger spacing, about their midpoint.
      const other = [...active.entries()].find(([id]) => id !== event.pointerId)![1];
      const before = Math.hypot(previous[0] - other[0], previous[1] - other[1]);
      const after = Math.hypot(p[0] - other[0], p[1] - other[1]);
      if (before > 0) updateCamera((v) => zoomAt(v, (p[0] + other[0]) / 2, (p[1] + other[1]) / 2, after / before));
    }
    active.set(event.pointerId, p);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!view) return;
    const centre = (factor: number) => zoomAt(view, view.width / 2, view.height / 2, factor);
    const actions: Record<string, () => void> = {
      ArrowLeft: () => setCamera(panBy(view, KEY_PAN, 0)),
      ArrowRight: () => setCamera(panBy(view, -KEY_PAN, 0)),
      ArrowUp: () => setCamera(panBy(view, 0, KEY_PAN)),
      ArrowDown: () => setCamera(panBy(view, 0, -KEY_PAN)),
      '+': () => setCamera(centre(1.25)),
      '=': () => setCamera(centre(1.25)),
      '-': () => setCamera(centre(0.8)),
      '0': fit,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const status = !webgl2 ? 'WebGL2 is not available in this browser.' : (error ?? (busy ? 'Solving…' : ''));

  return (
    <div
      ref={containerRef}
      className="viewport"
      tabIndex={0}
      role="region"
      aria-label="Results viewport"
      aria-describedby="viewport-help"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setProbe(null)}
      onDoubleClick={fit}
      onKeyDown={onKeyDown}
    >
      <canvas ref={glCanvasRef} className="viewport-canvas" />
      <canvas ref={overlayRef} className="viewport-canvas" />

      {result && <Legend field={field} range={range} stops={stops} bands={display.bands} stress={display.stress} />}

      {probe && (
        <div className="probe" style={{ transform: `translate(${probe.sx + 14}px, ${probe.sy + 14}px)` }}>
          <div>
            <span className="muted">{field.label.split(' ').at(-1)}</span> {formatWithUnit(probe.value, field.unit)}
          </div>
          <div>
            <span className="muted">u</span> ({formatWithUnit(probe.ux, 'mm')}, {formatWithUnit(probe.uy, 'mm')})
          </div>
        </div>
      )}

      <div className={error ? 'viewport-status is-error' : 'viewport-status'} aria-live="polite">
        {status}
      </div>
      <p id="viewport-help" className="viewport-help">
        Drag to pan, scroll or pinch to zoom, double-click to fit. Keys: arrows pan, + and − zoom, 0 fits.
      </p>
    </div>
  );
}

function readOverlayColors(element: HTMLElement): OverlayColors {
  const css = getComputedStyle(element);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    outline: v('--viz-outline'),
    ghost: v('--text-muted'),
    support: v('--viz-support'),
    load: v('--accent'),
    label: v('--text'),
  };
}
