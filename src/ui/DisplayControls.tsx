import { useId } from 'react';
import { FIELDS, type FieldId, type StressDisplay } from '../render/fields';
import { formatNumber } from './format';
import type { DisplaySettings } from './Viewport';

interface DisplayControlsProps {
  display: DisplaySettings;
  onChange: (display: DisplaySettings) => void;
  /** Multiplier on the automatic deformation scale. */
  deformationFactor: number;
  onDeformationFactor: (factor: number) => void;
  deformationScale: number;
}

const BANDS = 10;

const STRESS_OPTIONS: [StressDisplay, string][] = [
  ['average', 'Averaged'],
  ['spr', 'SPR'],
  ['element', 'Element'],
];

export function DisplayControls({
  display,
  onChange,
  deformationFactor,
  onDeformationFactor,
  deformationScale,
}: DisplayControlsProps) {
  const ids = { field: useId(), deform: useId() };
  const set = (patch: Partial<DisplaySettings>) => onChange({ ...display, ...patch });

  return (
    <div className="toolbar" role="toolbar" aria-label="Display">
      <div className="toolbar-group">
        <label htmlFor={ids.field} className="visually-hidden">
          Field
        </label>
        <select id={ids.field} value={display.field} onChange={(e) => set({ field: e.target.value as FieldId })}>
          {FIELDS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="toolbar-group segmented">
        <legend className="visually-hidden">Stress values</legend>
        {STRESS_OPTIONS.map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="stress" checked={display.stress === value} onChange={() => set({ stress: value })} />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="toolbar-group">
        <label>
          <input type="checkbox" checked={display.bands > 0} onChange={(e) => set({ bands: e.target.checked ? BANDS : 0 })} />
          Bands
        </label>
        <label>
          <input type="checkbox" checked={display.showMesh} onChange={(e) => set({ showMesh: e.target.checked })} />
          Mesh
        </label>
        <label>
          <input
            type="checkbox"
            checked={display.showUndeformed}
            onChange={(e) => set({ showUndeformed: e.target.checked })}
          />
          Undeformed
        </label>
      </div>

      <div className="toolbar-group deform">
        <label htmlFor={ids.deform}>Deformation</label>
        <input
          id={ids.deform}
          type="range"
          min={0}
          max={3}
          step={0.05}
          value={deformationFactor}
          onChange={(e) => onDeformationFactor(Number(e.target.value))}
        />
        <output htmlFor={ids.deform}>×{formatNumber(deformationScale)}</output>
      </div>
    </div>
  );
}
