import { useId, useState } from 'react';

interface NumberFieldProps {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

/**
 * Number input that only reports values inside [min, max]. While the text is
 * invalid it shows an error and leaves the model unchanged; on blur it snaps
 * back to the last valid value.
 */
export function NumberField({ label, unit, value, min, max, step, onChange }: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const parsed = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-input">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={editing ? text : String(value)}
          aria-invalid={editing && !valid}
          aria-describedby={`${id}-hint`}
          onFocus={() => {
            setText(String(value));
            setEditing(true);
          }}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const n = Number(next);
            if (next.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n);
          }}
          onBlur={() => setEditing(false)}
        />
        <span className="field-unit">{unit}</span>
      </div>
      <span id={`${id}-hint`} className={editing && !valid ? 'field-error' : 'visually-hidden'}>
        {min} to {max} {unit}
      </span>
    </div>
  );
}
