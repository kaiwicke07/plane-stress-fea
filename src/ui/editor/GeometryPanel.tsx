import { useId, useState } from 'react';
import type { Selection } from '../../editor/interaction';
import {
  deleteHole,
  deleteVertex,
  type EdgeCondition,
  type EditorGeometry,
  edgeLength,
  edgeSegment,
  insertVertex,
  type LoadSpec,
  moveVertex,
  polygonHole,
  setCondition,
  updateCircle,
} from '../../editor/model';
import { TEMPLATES } from '../../editor/templates';
import { type Tool, TOOLS } from '../../editor/tools';
import type { Issue } from '../../editor/validate';
import type { SupportKind } from '../../model/spec';
import { formatWithUnit } from '../format';
import { NumberField } from '../NumberField';

interface GeometryPanelProps {
  geometry: EditorGeometry;
  selection: Selection;
  issues: Issue[];
  tool: Tool;
  snap: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onChange: (next: EditorGeometry, commit: boolean) => void;
  onSelect: (selection: Selection) => void;
  onTool: (tool: Tool) => void;
  onSnap: (snap: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onTemplate: (id: string) => void;
}

const COORD = { min: -10_000, max: 10_000, step: 0.5 };
const FORCE = { min: -1e7, max: 1e7, step: 10 };
const STRESS = { min: -1e4, max: 1e4, step: 1 };

const SUPPORT_OPTIONS: [SupportKind | '', string][] = [
  ['', 'None'],
  ['fixed', 'Fixed (u = v = 0)'],
  ['roller-x', 'Roller, fixes x (u = 0)'],
  ['roller-y', 'Roller, fixes y (v = 0)'],
];

const LOAD_DEFAULTS: Record<LoadSpec['kind'], LoadSpec> = {
  force: { kind: 'force', fx: 0, fy: -1000 },
  pressure: { kind: 'pressure', p: 10 },
  traction: { kind: 'traction', tx: 10, ty: 0 },
};

export function GeometryPanel(props: GeometryPanelProps) {
  const { geometry: geo, issues } = props;
  const ids = { template: useId(), snap: useId() };
  const [template, setTemplate] = useState(TEMPLATES[0].id);

  return (
    <>
      <h3>Tools</h3>
      <fieldset className="tool-grid">
        <legend className="visually-hidden">Editing tool</legend>
        {TOOLS.map((t) => (
          <label key={t.id}>
            <input type="radio" name="tool" checked={props.tool === t.id} onChange={() => props.onTool(t.id)} />
            {t.label}
          </label>
        ))}
      </fieldset>
      <div className="button-row">
        <label htmlFor={ids.snap} className="inline-check">
          <input id={ids.snap} type="checkbox" checked={props.snap} onChange={(e) => props.onSnap(e.target.checked)} />
          Snap to grid
        </label>
        <button type="button" onClick={props.onUndo} disabled={!props.canUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" onClick={props.onRedo} disabled={!props.canRedo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
      </div>

      <div className="field">
        <label htmlFor={ids.template}>Start from a template</label>
        <div className="field-input">
          <select id={ids.template} value={template} onChange={(e) => setTemplate(e.target.value)}>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => props.onTemplate(template)}>
            Load
          </button>
        </div>
        <p className="muted field-note">
          {TEMPLATES.find((t) => t.id === template)?.description} Replaces the current part; Undo brings it back.
        </p>
      </div>

      <h3>Selection</h3>
      <Inspector {...props} />

      {issues.length > 0 && (
        <>
          <h3>To solve</h3>
          <ul className="issues">
            {issues.map((issue, i) => (
              <li key={i} className={`issue issue-${issue.level}`}>
                <span aria-hidden="true">{issue.level === 'error' ? '✕' : '!'}</span> {issue.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {geo.outline.points.length === 0 && <p className="muted field-note">Pick the Outline tool to draw a part.</p>}
    </>
  );
}

function Inspector({ geometry: geo, selection, onChange, onSelect }: GeometryPanelProps) {
  if (!selection) return <p className="muted field-note">Nothing selected. Click an edge, corner or hole.</p>;

  if (selection.kind === 'vertex') {
    const poly = selection.hole ? polygonHole(geo, selection.hole) : geo.outline;
    const point = poly?.points[selection.index];
    if (!poly || !point) return null;
    const set = (x: number, y: number) => onChange(moveVertex(geo, selection, [x, y]), true);
    return (
      <>
        <p className="muted field-note">{selection.hole ? 'Hole corner' : 'Outline corner'}</p>
        <NumberField label="x" unit="mm" value={point[0]} {...COORD} onChange={(x) => set(x, point[1])} />
        <NumberField label="y" unit="mm" value={point[1]} {...COORD} onChange={(y) => set(point[0], y)} />
        <div className="button-row">
          <button
            type="button"
            disabled={poly.points.length <= 3}
            onClick={() => {
              onChange(deleteVertex(geo, selection), true);
              onSelect(null);
            }}
          >
            Delete corner
          </button>
        </div>
      </>
    );
  }

  const circle =
    selection.kind === 'hole'
      ? geo.holes.find((h) => h.id === selection.hole)
      : geo.holes.find((h) => h.kind === 'circle' && h.edge === selection.edge);
  const circleFields = circle?.kind === 'circle' && (
    <>
      <NumberField label="Centre x" unit="mm" value={circle.cx} {...COORD} onChange={(cx) => onChange(updateCircle(geo, circle.id, { cx }), true)} />
      <NumberField label="Centre y" unit="mm" value={circle.cy} {...COORD} onChange={(cy) => onChange(updateCircle(geo, circle.id, { cy }), true)} />
      <NumberField label="Radius" unit="mm" value={circle.r} min={0.01} max={5000} step={0.5} onChange={(r) => onChange(updateCircle(geo, circle.id, { r }), true)} />
    </>
  );
  const owningHole =
    circle ??
    (selection.kind === 'edge' ? geo.holes.find((h) => h.kind === 'polygon' && h.edges.includes(selection.edge)) : undefined);
  const deleteButton = owningHole && (
    <button
      type="button"
      onClick={() => {
        onChange(deleteHole(geo, owningHole.id), true);
        onSelect(null);
      }}
    >
      Delete hole
    </button>
  );

  if (selection.kind === 'hole') {
    return (
      <>
        <p className="muted field-note">Circular hole. Select its edge to add a support or load.</p>
        {circleFields}
        <div className="button-row">{deleteButton}</div>
      </>
    );
  }

  const edge = selection.edge;
  const segment = edgeSegment(geo, edge);
  return (
    <>
      <p className="muted field-note">
        {circle ? 'Hole edge' : owningHole ? 'Hole edge' : 'Outline edge'} · length {formatWithUnit(edgeLength(geo, edge), 'mm')}
      </p>
      <ConditionEditor condition={geo.conditions[edge] ?? {}} onChange={(c) => onChange(setCondition(geo, edge, c), true)} />
      {circleFields}
      <div className="button-row">
        {segment && (
          <button
            type="button"
            onClick={() =>
              onChange(
                insertVertex(geo, edge, [(segment[0][0] + segment[1][0]) / 2, (segment[0][1] + segment[1][1]) / 2]),
                true,
              )
            }
          >
            Add corner at midpoint
          </button>
        )}
        {deleteButton}
      </div>
    </>
  );
}

function ConditionEditor({ condition, onChange }: { condition: EdgeCondition; onChange: (c: EdgeCondition) => void }) {
  const ids = { support: useId(), load: useId() };
  const { load } = condition;
  const setLoad = (next: LoadSpec | undefined) => onChange({ ...condition, load: next });

  return (
    <>
      <div className="field">
        <label htmlFor={ids.support}>Support</label>
        <select
          id={ids.support}
          value={condition.support ?? ''}
          onChange={(e) => onChange({ ...condition, support: (e.target.value || undefined) as SupportKind | undefined })}
        >
          {SUPPORT_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={ids.load}>Load</label>
        <select
          id={ids.load}
          value={load?.kind ?? ''}
          onChange={(e) => setLoad(e.target.value ? LOAD_DEFAULTS[e.target.value as LoadSpec['kind']] : undefined)}
        >
          <option value="">None</option>
          <option value="force">Total force, spread evenly</option>
          <option value="pressure">Pressure (normal to the edge)</option>
          <option value="traction">Traction (stress, x and y)</option>
        </select>
      </div>
      {load?.kind === 'force' && (
        <>
          <NumberField label="Fx" unit="N" value={load.fx} {...FORCE} onChange={(fx) => setLoad({ ...load, fx })} />
          <NumberField label="Fy" unit="N" value={load.fy} {...FORCE} onChange={(fy) => setLoad({ ...load, fy })} />
        </>
      )}
      {load?.kind === 'pressure' && (
        <NumberField label="p (into the part)" unit="MPa" value={load.p} {...STRESS} onChange={(p) => setLoad({ ...load, p })} />
      )}
      {load?.kind === 'traction' && (
        <>
          <NumberField label="tx" unit="MPa" value={load.tx} {...STRESS} onChange={(tx) => setLoad({ ...load, tx })} />
          <NumberField label="ty" unit="MPa" value={load.ty} {...STRESS} onChange={(ty) => setLoad({ ...load, ty })} />
        </>
      )}
    </>
  );
}
