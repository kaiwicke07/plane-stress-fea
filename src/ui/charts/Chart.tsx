import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatNumber } from '../format';
import { makeScale, paddedDomain, type ScaleKind } from './scales';

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: ChartPoint[];
  /** Draw a connecting line (default true) and/or markers (default true). */
  line?: boolean;
  markers?: boolean;
  dash?: string;
  /**
   * Reference curves (analytical solutions, slope guides) do not create
   * crosshair stops; they are read off by interpolation at the data's x.
   */
  reference?: boolean;
}

export interface Axis {
  label: string;
  scale?: ScaleKind;
  /** Values that must be inside the domain, such as 0 or a reference value. */
  include?: number[];
  /** Tick values to use instead of the automatic ones, such as the refinement levels. */
  ticks?: number[];
  format?: (v: number) => string;
}

interface ChartProps {
  title: string;
  /** One sentence for screen readers saying what the chart shows. */
  summary: string;
  x: Axis;
  y: Axis;
  series: ChartSeries[];
  height?: number;
}

const MARGIN = { top: 12, right: 16, bottom: 44, left: 60 };

export function Chart({ title, summary, x, y, series, height = 280 }: ChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const clipId = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const xKind = x.scale ?? 'linear';
  const yKind = y.scale ?? 'linear';
  const plot = { w: Math.max(0, width - MARGIN.left - MARGIN.right), h: height - MARGIN.top - MARGIN.bottom };

  const { sx, sy, stops } = useMemo(() => {
    const xs = series.flatMap((s) => s.points.map((p) => p.x));
    const ys = series.flatMap((s) => s.points.map((p) => p.y));
    const sx = makeScale(xKind, paddedDomain(xs, xKind, x.include), [0, plot.w]);
    const sy = makeScale(yKind, paddedDomain(ys, yKind, y.include), [plot.h, 0]);
    if (x.ticks) sx.ticks = x.ticks;
    if (y.ticks) sy.ticks = y.ticks;
    // Crosshair stops: every distinct x of the data (non-reference) series.
    const stops = [...new Set(series.filter((s) => !s.reference).flatMap((s) => s.points.map((p) => p.x)))].sort(
      (a, b) => a - b,
    );
    return { sx, sy, stops };
  }, [series, xKind, yKind, x.include, y.include, x.ticks, y.ticks, plot.w, plot.h]);

  const fx = x.format ?? ((v: number) => formatNumber(v));
  const fy = y.format ?? ((v: number) => formatNumber(v));
  const activeX = active === null ? null : stops[active];

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (stops.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left - MARGIN.left;
    let best = 0;
    stops.forEach((v, i) => {
      if (Math.abs(sx(v) - px) < Math.abs(sx(stops[best]) - px)) best = i;
    });
    setActive(best);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (stops.length === 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      setActive((a) => Math.min(stops.length - 1, Math.max(0, (a ?? (step > 0 ? -1 : stops.length)) + step)));
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  };

  const readout =
    activeX === null
      ? []
      : series.flatMap((s) => {
          const v = valueAt(s, activeX, xKind);
          return v === null ? [] : [{ s, v }];
        });

  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      {series.length > 1 && (
        <ul className="chart-legend">
          {series.map((s) => (
            <li key={s.id}>
              <svg width="18" height="10" aria-hidden="true">
                {s.line !== false && (
                  <line x1="0" y1="5" x2="18" y2="5" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
                )}
                {s.markers !== false && <circle cx="9" cy="5" r="3.5" fill={s.color} />}
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div ref={wrapRef} className="chart-body">
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${title}. ${summary}`}
            tabIndex={0}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
          >
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              {/* Grid and axes: hairline, recessive. */}
              {sy.ticks.map((t) => (
                <g key={`y${t}`} className="chart-grid">
                  <line x1={0} x2={plot.w} y1={sy(t)} y2={sy(t)} />
                  <text x={-8} y={sy(t)} textAnchor="end" dominantBaseline="middle">
                    {fy(t)}
                  </text>
                </g>
              ))}
              {sx.ticks.map((t) => (
                <g key={`x${t}`} className="chart-grid">
                  <line x1={sx(t)} x2={sx(t)} y1={0} y2={plot.h} />
                  <text x={sx(t)} y={plot.h + 16} textAnchor="middle">
                    {fx(t)}
                  </text>
                </g>
              ))}
              <text className="chart-axis-label" x={plot.w / 2} y={plot.h + 36} textAnchor="middle">
                {x.label}
              </text>
              <text
                className="chart-axis-label"
                transform={`translate(${-46},${plot.h / 2}) rotate(-90)`}
                textAnchor="middle"
              >
                {y.label}
              </text>

              <clipPath id={clipId}>
                <rect x={0} y={0} width={plot.w} height={plot.h} />
              </clipPath>
              <g clipPath={`url(#${CSS.escape(clipId)})`}>
                {series.map(
                  (s) =>
                    s.line !== false && (
                      <polyline
                        key={s.id}
                        className="chart-line"
                        points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
                        stroke={s.color}
                        strokeDasharray={s.dash}
                      />
                    ),
                )}
              </g>
              {series.map(
                (s) =>
                  s.markers !== false && (
                    <g key={`m${s.id}`}>
                      {s.points.map((p, i) => (
                        <circle
                          key={i}
                          className="chart-marker"
                          cx={sx(p.x)}
                          cy={sy(p.y)}
                          r={activeX !== null && sameX(p.x, activeX) ? 5.5 : 4}
                          fill={s.color}
                        />
                      ))}
                    </g>
                  ),
              )}
              {activeX !== null && <line className="chart-crosshair" x1={sx(activeX)} x2={sx(activeX)} y1={0} y2={plot.h} />}
            </g>
          </svg>
        )}
        {activeX !== null && readout.length > 0 && (
          <div
            className="chart-tooltip"
            style={{
              left: Math.min(MARGIN.left + sx(activeX) + 12, Math.max(0, width - 220)),
              top: MARGIN.top + 4,
            }}
          >
            <div className="chart-tooltip-x">
              {x.label}: {fx(activeX)}
            </div>
            {readout.map(({ s, v }) => (
              <div key={s.id} className="chart-tooltip-row">
                <svg width="12" height="8" aria-hidden="true">
                  <line x1="0" y1="4" x2="12" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
                </svg>
                <strong>{fy(v)}</strong> <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

const sameX = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

/** A series' value at x: exact for data points, interpolated for reference curves. */
function valueAt(s: ChartSeries, x: number, kind: ScaleKind): number | null {
  const exact = s.points.find((p) => sameX(p.x, x));
  if (exact) return exact.y;
  if (!s.reference) return null;
  const pts = [...s.points].sort((a, b) => a.x - b.x);
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    if (x < a.x || x > b.x) continue;
    if (kind === 'log') {
      const t = Math.log(x / a.x) / Math.log(b.x / a.x);
      return a.y > 0 && b.y > 0 ? a.y * (b.y / a.y) ** t : a.y + t * (b.y - a.y);
    }
    return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
  }
  return null;
}
