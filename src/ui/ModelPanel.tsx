import { type ReactNode, useId } from 'react';
import { MATERIALS } from '../core/material';
import { CUSTOM_PART, PRESETS, presetById } from '../presets';
import { NumberField } from './NumberField';

export interface ModelInputs {
  presetId: string;
  /** Parameter values per preset, so switching presets keeps edits. */
  values: Record<string, Record<string, number>>;
  density: number;
  materialIndex: number;
  thickness: number;
}

interface ModelPanelProps {
  inputs: ModelInputs;
  onChange: (inputs: ModelInputs) => void;
  /** Geometry editor controls, shown when the custom part is selected. */
  customPanel: ReactNode;
}

const CUSTOM_DENSITY_NOTE =
  "Elements across the part's narrowest feature (its shortest outline edge); holes are refined further.";

const DENSITY_RANGE = { min: 2, max: 40 } as const;

export function ModelPanel({ inputs, onChange, customPanel }: ModelPanelProps) {
  const ids = { preset: useId(), density: useId(), material: useId() };
  const custom = inputs.presetId === CUSTOM_PART;
  const preset = custom ? null : presetById(inputs.presetId);
  const values = preset ? inputs.values[preset.id] : {};
  const material = MATERIALS[inputs.materialIndex];

  return (
    <aside className="panel panel-model" aria-label="Model">
      <h2>Model</h2>

      <div className="field">
        <label htmlFor={ids.preset}>Part</label>
        <select
          id={ids.preset}
          value={inputs.presetId}
          onChange={(e) => onChange({ ...inputs, presetId: e.target.value })}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={CUSTOM_PART}>Custom part (draw your own)</option>
        </select>
        <p className="muted field-note">
          {preset ? preset.description : 'Draw an outline and holes, then set supports and loads on its edges.'}
        </p>
      </div>

      {custom && customPanel}

      {preset?.params.map((p) => (
        <NumberField
          key={`${preset.id}.${p.key}`}
          label={p.label}
          unit={p.unit}
          value={values[p.key]}
          min={p.min}
          max={p.max}
          step={p.step}
          onChange={(v) => onChange({ ...inputs, values: { ...inputs.values, [preset.id]: { ...values, [p.key]: v } } })}
        />
      ))}

      <h3>Mesh</h3>
      <div className="field">
        <label htmlFor={ids.density}>
          Density <output htmlFor={ids.density}>{inputs.density}</output>
        </label>
        <input
          id={ids.density}
          type="range"
          min={DENSITY_RANGE.min}
          max={DENSITY_RANGE.max}
          step={1}
          value={inputs.density}
          aria-describedby={`${ids.density}-note`}
          onChange={(e) => onChange({ ...inputs, density: Number(e.target.value) })}
        />
        <p id={`${ids.density}-note`} className="muted field-note">
          {preset ? preset.densityNote : CUSTOM_DENSITY_NOTE}
        </p>
      </div>

      <h3>Material</h3>
      <div className="field">
        <label htmlFor={ids.material}>Material</label>
        <select
          id={ids.material}
          value={inputs.materialIndex}
          onChange={(e) => onChange({ ...inputs, materialIndex: Number(e.target.value) })}
        >
          {MATERIALS.map((m, i) => (
            <option key={m.name} value={i}>
              {m.name}
            </option>
          ))}
        </select>
        <p className="muted field-note">
          E = {(material.E / 1000).toFixed(1)} GPa · ν = {material.nu} · σy = {material.yieldStrength} MPa
        </p>
      </div>
      <NumberField
        label="Thickness"
        unit="mm"
        value={inputs.thickness}
        min={0.1}
        max={100}
        step={0.5}
        onChange={(thickness) => onChange({ ...inputs, thickness })}
      />
    </aside>
  );
}
