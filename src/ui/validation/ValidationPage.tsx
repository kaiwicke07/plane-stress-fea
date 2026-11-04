import type { ReactNode } from 'react';
import { SUITE_LABEL, SUITE_ORDER, type SuiteKey } from '../../validation/suite';
import { CantileverIntro, ClampedCantilever, ExactCantilever, MidspanProfile } from './CantileverSections';
import { LstCantilever, LstPlate } from './LstSections';
import { HeywoodPlates, KirschPlate, StressDefinitions } from './PlateSections';
import { type StudyStatus, useValidation } from './useValidation';

export function ValidationPage() {
  const { results, status, finished, rerun } = useValidation();

  const section = (key: SuiteKey, render: () => ReactNode, needs: SuiteKey[] = []) =>
    results[key] && needs.every((k) => results[k]) ? render() : <StudyPlaceholder status={status[key]} />;

  return (
    <main className="page">
      <div className="page-inner">

        <section className="intro">
          <h1 className="page-title">Validation</h1>
          <p>
            Every number on this page is computed <strong>live in your browser</strong>, by the same functions the test
            suite runs in CI, and checked against the same tolerances. The derivations are in <code>docs/math/</code>{' '}
            in the repository (notes 6, 8 and 10).
          </p>
          <ul className="progress" aria-label="Studies">
            {SUITE_ORDER.map((key) => (
              <li key={key}>
                <StatusChip status={status[key]} /> {SUITE_LABEL[key]}
              </li>
            ))}
          </ul>
          <button type="button" onClick={rerun} disabled={!finished}>
            Run again
          </button>
        </section>

        <section className="study">
          <h2>Cantilever: convergence to the exact solution</h2>
          <CantileverIntro />
          {section('cantileverExact', () => (
            <ExactCantilever study={results.cantileverExact!} />
          ))}
        </section>

        <section className="study">
          <h2>Cantilever: clamped wall against beam theory</h2>
          {section('cantileverClamped', () => (
            <ClampedCantilever runs={results.cantileverClamped!} />
          ))}
        </section>

        <section className="study">
          <h2>Cantilever: bending stress</h2>
          {section('midspanProfile', () => (
            <MidspanProfile points={results.midspanProfile!} />
          ))}
        </section>

        <section className="study">
          <h2>Plate with a hole: stress definitions</h2>
          <StressDefinitions />
        </section>

        <section className="study">
          <h2>Plate with a hole: Kirsch, gross basis</h2>
          {section('plateKirsch', () => (
            <KirschPlate runs={results.plateKirsch!} />
          ))}
        </section>

        <section className="study">
          <h2>Plate with a hole: Heywood, net basis</h2>
          {section('plateHeywood', () => (
            <HeywoodPlates runs={results.plateHeywood!} />
          ))}
        </section>

        <section className="study">
          <h2>6-node elements: cantilever</h2>
          {section(
            'cantileverLst',
            () => (
              <LstCantilever lst={results.cantileverLst!} cst={results.cantileverExact!} />
            ),
            ['cantileverExact'],
          )}
        </section>

        <section className="study">
          <h2>6-node elements: plate with a hole</h2>
          {section(
            'plateLst',
            () => (
              <LstPlate lst={results.plateLst!} cst={results.plateKirsch!} />
            ),
            ['plateKirsch'],
          )}
        </section>
      </div>
    </main>
  );
}

function StatusChip({ status }: { status?: StudyStatus }) {
  const state = status?.state ?? 'queued';
  const text = {
    queued: 'Queued',
    running: 'Running…',
    done: status?.state === 'done' ? `Done in ${(status.ms / 1000).toFixed(1)} s` : '',
    failed: 'Failed',
  }[state];
  const icon = { queued: '○', running: '◌', done: '✓', failed: '✕' }[state];
  return (
    <span className={`chip chip-${state}`}>
      <span aria-hidden="true">{icon}</span> {text}
    </span>
  );
}

function StudyPlaceholder({ status }: { status?: StudyStatus }) {
  if (status?.state === 'failed') return <p className="field-error">This study failed: {status.message}</p>;
  return <p className="muted placeholder">{status?.state === 'running' ? 'Running…' : 'Waiting for earlier studies…'}</p>;
}
