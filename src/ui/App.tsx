import { useEffect, useMemo, useState } from 'react';
import { MATERIALS } from '../core/material';
import { checkpoint, type History, initHistory, pushHistory, redo, undo } from '../editor/history';
import { deleteSelection, type Selection } from '../editor/interaction';
import type { EditorGeometry } from '../editor/model';
import { loadGeometry, saveGeometry } from '../editor/storage';
import { templateById } from '../editor/templates';
import type { Tool } from '../editor/tools';
import { validateGeometry } from '../editor/validate';
import { CUSTOM_PART, defaultValues, PRESETS } from '../presets';
import { autoDeformationScale, summarize } from '../results/summary';
import type { JobInput } from '../worker/client';
import { DisplayControls } from './DisplayControls';
import { EditorCanvas } from './editor/EditorCanvas';
import { GeometryPanel } from './editor/GeometryPanel';
import { type ModelInputs, ModelPanel } from './ModelPanel';
import { ResultsPanel } from './ResultsPanel';
import { useSolver } from './useSolver';
import { type DisplaySettings, Viewport } from './Viewport';

const INITIAL_INPUTS: ModelInputs = {
  presetId: PRESETS[0].id,
  values: Object.fromEntries(PRESETS.map((p) => [p.id, defaultValues(p)])),
  density: 8,
  elementOrder: 1,
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

type Tab = 'geometry' | 'results';

export function App() {
  const [inputs, setInputs] = useState(INITIAL_INPUTS);
  const [display, setDisplay] = useState(INITIAL_DISPLAY);
  const [deformationFactor, setDeformationFactor] = useState(1);

  // Geometry editor state.
  const [history, setHistory] = useState<History<EditorGeometry>>(() =>
    initHistory(loadGeometry() ?? templateById('bracket').build()),
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [snap, setSnap] = useState(true);
  const [fitKey, setFitKey] = useState(0);
  const [tab, setTab] = useState<Tab>('geometry');

  const custom = inputs.presetId === CUSTOM_PART;
  const geometry = history.present;
  const issues = useMemo(() => validateGeometry(geometry), [geometry]);
  const blocking = issues.some((i) => i.level === 'error');

  useEffect(() => {
    const timer = setTimeout(() => saveGeometry(geometry), 400);
    return () => clearTimeout(timer);
  }, [geometry]);

  const job = useMemo<JobInput | null>(() => {
    const common = {
      density: inputs.density,
      elementOrder: inputs.elementOrder,
      material: MATERIALS[inputs.materialIndex],
      thickness: inputs.thickness,
    };
    if (!custom) {
      return { ...common, source: { kind: 'preset', presetId: inputs.presetId, values: inputs.values[inputs.presetId] } };
    }
    return blocking ? null : { ...common, source: { kind: 'custom', geometry } };
  }, [inputs, custom, blocking, geometry]);
  // Meshing a custom part takes longer; wait for a pause in editing.
  const { result, error, busy } = useSolver(job, custom ? 300 : 60);

  const summary = useMemo(() => (result ? summarize(result) : null), [result]);
  const deformationScale = useMemo(
    () => (result ? autoDeformationScale(result) * deformationFactor : 0),
    [result, deformationFactor],
  );

  const edit = (next: EditorGeometry, commit: boolean) => setHistory((h) => pushHistory(h, next, commit));
  const editor = {
    onChange: edit,
    onUndo: () => setHistory(undo),
    onRedo: () => setHistory(redo),
    onSelect: setSelection,
  };

  const loadTemplate = (id: string) => {
    edit(templateById(id).build(), true);
    setSelection(null);
    setTool('select');
    setFitKey((k) => k + 1);
  };

  const showEditor = custom && tab === 'geometry';
  const status = custom && blocking ? 'Fix the items listed under “To solve” to see results.' : error;

  return (
    <div className="app">
      <h1 className="visually-hidden">Plane stress solver</h1>

      <ModelPanel
        inputs={inputs}
        onChange={setInputs}
        customPanel={
          <GeometryPanel
            geometry={geometry}
            selection={selection}
            issues={issues}
            tool={tool}
            snap={snap}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            onTool={setTool}
            onSnap={setSnap}
            onTemplate={loadTemplate}
            {...editor}
          />
        }
      />

      <main className="viewport-area" aria-label="Viewport">
        {custom && (
          <div className="tabs" role="tablist" aria-label="View">
            {(['geometry', 'results'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'tab is-active' : 'tab'}
                onClick={() => setTab(t)}
              >
                {t === 'geometry' ? 'Geometry' : 'Results'}
                {t === 'results' && busy && ' …'}
              </button>
            ))}
          </div>
        )}
        {showEditor ? (
          <EditorCanvas
            geometry={geometry}
            selection={selection}
            tool={tool}
            snap={snap}
            fitKey={fitKey}
            onCheckpoint={() => setHistory(checkpoint)}
            onToolDone={() => setTool('select')}
            onDelete={() => {
              edit(deleteSelection(geometry, selection), true);
              setSelection(null);
            }}
            {...editor}
          />
        ) : (
          <>
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
              error={status}
            />
          </>
        )}
      </main>

      <ResultsPanel result={result} summary={summary} deformationScale={deformationScale} />
    </div>
  );
}
