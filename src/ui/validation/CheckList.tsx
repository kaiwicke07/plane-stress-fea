import type { Check } from '../../validation/criteria';

/** Pass/fail checks, each with an icon and a word as well as colour. */
export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="checks" aria-label="Checks">
      {checks.map((c) => (
        <li key={c.label} className={c.pass ? 'check is-pass' : 'check is-fail'}>
          <span className="check-status">
            <span aria-hidden="true">{c.pass ? '✓' : '✕'}</span> {c.pass ? 'Pass' : 'Fail'}
          </span>
          <span className="check-label">{c.label}</span>
          <span className="check-value">
            {c.measured} <span className="muted">(required {c.required})</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
