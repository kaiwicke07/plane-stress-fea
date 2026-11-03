import { cssGradient } from '../render/colormap';
import type { FieldDef } from '../render/fields';
import { formatNumber } from './format';

interface LegendProps {
  field: FieldDef;
  range: [number, number];
  stops: readonly string[];
  bands: number;
  smooth: boolean;
}

/** Vertical scale legend: gradient bar with five ticks, unit and recovery method. */
export function Legend({ field, range, stops, bands, smooth }: LegendProps) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => range[0] + f * (range[1] - range[0]));
  return (
    <figure className="legend" aria-label={`${field.label} colour scale`}>
      <figcaption>
        <span className="legend-title">{field.label}</span>
        <span className="legend-sub">
          {field.unit} · {smooth ? 'nodal average' : 'element'}
        </span>
      </figcaption>
      <div className="legend-body">
        <div className="legend-bar" style={{ backgroundImage: cssGradient(stops, bands) }} />
        <ol className="legend-ticks">
          {ticks.reverse().map((t, i) => (
            <li key={i}>{formatNumber(t)}</li>
          ))}
        </ol>
      </div>
    </figure>
  );
}
