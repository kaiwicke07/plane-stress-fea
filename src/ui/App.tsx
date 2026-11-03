import { useMemo, useState } from 'react';
import { MATERIALS } from '../core/material';
import { defaultValues, PRESETS } from '../presets';
import { autoDeformationScale, summarize } from '../results/summary';
import type { JobInput } from '../worker/client';
import { DisplayControls } from './DisplayControls';
import { type ModelInputs, ModelPanel } from './ModelPanel';
import { ResultsPanel } from './ResultsPanel';
import { useSolver } from './useSolver';
import { type DisplaySettings, Viewport } from './Viewport';

const INITIAL_INPUTS: ModelInputs = {
  presetId: PRESETS[0].id,
  values: Object.fromEntries(PRESETS.map((p) => [p.id, defaultValues(p)])),
  density: 8,
  materialIndex: 0,
  thickness: 5,
};

const INITIAL_DISPLAY: DisplaySettings = {
  field: 'vonMises',
  stress: 'spr',
  bands: 0,
  showMesh: true,
  showUndeformed: true,
};

export function App() {
  const [inputs, setInputs] = useState(INITIAL_INPUTS);
  const [display, setDisplay] = useState(INITIAL_DISPLAY);
  const [deformationFactor, setDeformationFactor] = useState(1);

  const job = useMemo<JobInput>(
    () => ({
      presetId: inputs.presetId,
      values: inputs.values[inputs.presetId],
      density: inputs.density,
      material: MATERIALS[inputs.materialIndex],
      thickness: inputs.thickness,
    }),
    [inputs],
  );
  const { result, error, busy } = useSolver(job);

  const summary = useMemo(() => (result ? summarize(result) : null), [result]);
  const deformationScale = useMemo(
    () => (result ? autoDeformationScale(result) * deformationFactor : 0),
    [result, deformationFactor],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>Plane Stress FEA</h1>
        <span className="app-tag">linear · plane stress · triangular elements</span>
      </header>

      <ModelPanel inputs={inputs} onChange={setInputs} />

      <main className="viewport-area" aria-label="Viewport">
        <DisplayControls
          display={display}
          onChange={setDisplay}
          deformationFactor={deformationFactor}
          onDeformationFactor={setDeformationFactor}
          deformationScale={deformationScale}
        />
        <Viewport
          result={result}
          display={display}
          deformationScale={deformationScale}
          busy={busy}
          error={error}
        />
      </main>

      <ResultsPanel result={result} summary={summary} deformationScale={deformationScale} />
    </div>
  );
}
