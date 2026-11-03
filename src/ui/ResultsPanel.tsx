import type { ResultSummary } from '../results/summary';
import type { SolveResult } from '../worker/job';
import { formatNumber, formatWithUnit } from './format';

interface ResultsPanelProps {
  result: SolveResult | null;
  summary: ResultSummary | null;
  deformationScale: number;
}

export function ResultsPanel({ result, summary, deformationScale }: ResultsPanelProps) {
  if (!result || !summary) {
    return (
      <aside className="panel panel-results" aria-label="Results">
        <h2>Results</h2>
        <p className="muted">Solving…</p>
      </aside>
    );
  }
  const { solution, material, timing } = result;
  const fos = summary.factorOfSafety;

  return (
    <aside className="panel panel-results" aria-label="Results">
      <h2>Results</h2>
      <dl className="stats">
        <dt>Max displacement</dt>
        <dd>{formatWithUnit(summary.maxDisplacement, 'mm')}</dd>
        <dt>Max von Mises (nodal)</dt>
        <dd>{formatWithUnit(summary.maxNodalVonMises, 'MPa')}</dd>
        <dt>Max von Mises (element)</dt>
        <dd>{formatWithUnit(summary.maxElementVonMises, 'MPa')}</dd>
        <dt>Factor of safety</dt>
        <dd>
          {formatNumber(fos)}{' '}
          <span className={fos >= 1 ? 'tag tag-good' : 'tag tag-critical'}>
            {fos >= 1 ? '✓ below yield' : '✕ yields'}
          </span>
        </dd>
      </dl>
      <p className="muted note">
        σy = {material.yieldStrength} MPa over the larger von Mises maximum. Linear elastic: past yield the
        stresses are not physical. Peaks at sharp corners and supports grow with mesh density.
      </p>

      <h3>Equilibrium</h3>
      <dl className="stats">
        <dt>Σ reactions</dt>
        <dd>
          ({formatWithUnit(summary.reaction[0], 'N')}, {formatWithUnit(summary.reaction[1], 'N')})
        </dd>
        <dt>Σ applied</dt>
        <dd>
          ({formatWithUnit(result.appliedForce[0], 'N')}, {formatWithUnit(result.appliedForce[1], 'N')})
        </dd>
        <dt>Imbalance</dt>
        <dd>{summary.equilibriumError.toExponential(1)}</dd>
      </dl>

      <h3>Solver</h3>
      <dl className="stats">
        <dt>Elements</dt>
        <dd>{summary.elements.toLocaleString()}</dd>
        <dt>Degrees of freedom</dt>
        <dd>{summary.dofs.toLocaleString()}</dd>
        <dt>PCG iterations</dt>
        <dd>{solution.solver.iterations.toLocaleString()}</dd>
        <dt>Time</dt>
        <dd>{formatNumber(timing.meshMs + timing.solveMs, 2)} ms</dd>
        <dt>Deformation scale</dt>
        <dd>×{formatNumber(deformationScale)}</dd>
      </dl>
    </aside>
  );
}
