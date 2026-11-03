import { cantileverExact, eulerBernoulliTip, timoshenkoTip } from '../../validation/analytical';
import { type ClampedWallRun, type ConvergenceStudy, DEFAULT_CANTILEVER, type ProfilePoint } from '../../validation/cases';
import { cantileverChecks, clampedChecks, clampedExtrapolation } from '../../validation/criteria';
import { Chart, type ChartSeries } from '../charts/Chart';
import { formatNumber } from '../format';
import { CheckList } from './CheckList';
import { pct, SERIES } from './series';

const P = DEFAULT_CANTILEVER;

/** Relative difference in brackets; none on the neutral axis, where the exact value is zero. */
const relative = (fe: number, exact: number) => (Math.abs(exact) > 1e-9 ? `(${pct(fe / exact - 1, 2)})` : '');

export function CantileverIntro() {
  return (
    <p>
      Steel cantilever, L = {P.length} mm, depth {P.depth} mm, thickness {P.thickness} mm, end load P = {P.load} N with
      the parabolic shear distribution of beam theory. Meshes have square cells split into alternating triangles, and
      each level halves the element size.
    </p>
  );
}

export function ExactCantilever({ study }: { study: ConvergenceStudy }) {
  const { runs, rates } = study;
  const finest = runs[runs.length - 1];
  // Slope guides through the finest point: e ∝ h² and e ∝ h.
  const guide = (id: string, label: string, e: number, p: number): ChartSeries => ({
    id,
    label,
    color: SERIES.guide,
    dash: '4 4',
    markers: false,
    reference: true,
    points: [runs[0].h, finest.h].map((h) => ({ x: h, y: e * (h / finest.h) ** p })),
  });
  const series: ChartSeries[] = [
    { id: 'tip', label: 'Tip deflection error', color: SERIES.c1, points: runs.map((r) => ({ x: r.h, y: r.tipError })) },
    { id: 'l2', label: 'L2 displacement error', color: SERIES.c2, points: runs.map((r) => ({ x: r.h, y: r.displacementL2 })) },
    { id: 'energy', label: 'Energy-norm error', color: SERIES.c3, points: runs.map((r) => ({ x: r.h, y: r.energy })) },
    guide('slope2', 'Slope 2 (theory, displacement)', finest.tipError, 2),
    guide('slope1', 'Slope 1 (theory, energy)', finest.energy, 1),
  ];

  return (
    <>
      <p>
        The wall nodes are given the exact elasticity solution (Timoshenko &amp; Goodier), so that field is the exact
        answer to the FE model's own boundary conditions and every bit of error is discretisation error. Theory for
        3-node triangles: displacement error O(h²), stress (energy-norm) error O(h). The tip and L2 errors agree to
        three digits at every level, so their lines lie on top of each other.
      </p>
      <Chart
        title="Error vs element size, log–log"
        summary={`Three error measures fall along slopes close to 2, 2 and 1 as the mesh is refined from ${runs[0].ny} to ${finest.ny} cells through the depth.`}
        x={{ label: 'Element size h (mm)', scale: 'log', ticks: runs.map((r) => r.h) }}
        y={{ label: 'Relative error', scale: 'log', format: (v) => pct(v, 2) }}
        series={series}
      />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Cells through depth</th>
              <th>DOFs</th>
              <th>h (mm)</th>
              <th>Tip error</th>
              <th>L2 error</th>
              <th>Energy error</th>
              <th>Order (tip / L2 / energy)</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={r.ny}>
                <td>{r.ny}</td>
                <td>{r.dofs.toLocaleString()}</td>
                <td>{formatNumber(r.h)}</td>
                <td>{pct(r.tipError)}</td>
                <td>{pct(r.displacementL2)}</td>
                <td>{pct(r.energy)}</td>
                <td>
                  {i === 0
                    ? '—'
                    : [rates.tip, rates.displacementL2, rates.energy].map((rate) => rate[i - 1].toFixed(2)).join(' / ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CheckList checks={cantileverChecks(study)} />
    </>
  );
}

export function ClampedCantilever({ runs }: { runs: ClampedWallRun[] }) {
  const [coarse, fine] = runs.slice(-2);
  const { tip: extrapolated, ratio } = clampedExtrapolation(coarse, fine);
  const timoshenko = timoshenkoTip(P);
  const eb = eulerBernoulliTip(P);
  const span = [runs[0].dofs, fine.dofs];
  const series: ChartSeries[] = [
    { id: 'fe', label: 'FE, clamped wall', color: SERIES.c1, points: runs.map((r) => ({ x: r.dofs, y: r.tipDeflection })) },
    { id: 'timo', label: 'Timoshenko beam (κ = 5/6)', color: SERIES.reference, markers: false, reference: true, points: span.map((x) => ({ x, y: timoshenko })) },
    { id: 'eb', label: 'Euler–Bernoulli beam', color: SERIES.guide, dash: '4 4', markers: false, reference: true, points: span.map((x) => ({ x, y: eb })) },
  ];

  return (
    <>
      <p>
        The engineer's model: every wall node fixed, compared with beam theory. Part of any difference here is
        modelling, not FE error. A clamped edge is not the same boundary condition as either idealisation of the exact
        solution, which is why the exact-wall study above comes first.
      </p>
      <Chart
        title="Tip deflection vs mesh size"
        summary={`FE tip deflection rises toward Timoshenko beam theory, ${formatNumber(timoshenko, 4)} mm, as the mesh is refined.`}
        x={{ label: 'Degrees of freedom', scale: 'log' }}
        y={{ label: 'Tip deflection (mm)', include: [timoshenko, eb] }}
        series={series}
      />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Cells through depth</th>
              <th>DOFs</th>
              <th>FE tip (mm)</th>
              <th>FE / Timoshenko</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.ny}>
                <td>{r.ny}</td>
                <td>{r.dofs.toLocaleString()}</td>
                <td>{formatNumber(r.tipDeflection, 4)}</td>
                <td>{r.ratioToTimoshenko.toFixed(4)}</td>
              </tr>
            ))}
            <tr className="row-emphasis">
              <td colSpan={2}>
                Richardson extrapolation ({coarse.ny}, {fine.ny}), order 2
              </td>
              <td>{formatNumber(extrapolated, 4)}</td>
              <td>{ratio.toFixed(4)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <CheckList checks={clampedChecks(coarse, fine)} />
    </>
  );
}

export function MidspanProfile({ points }: { points: ProfilePoint[] }) {
  const exact = cantileverExact(P);
  const dense = Array.from({ length: 41 }, (_, k) => -P.depth / 2 + (k * P.depth) / 40).map((y) => ({
    x: y,
    y: exact.stress(P.length / 2, y)[0],
  }));
  const top = points[points.length - 1];
  const series: ChartSeries[] = [
    { id: 'exact', label: 'Exact, σ = M·y/I', color: SERIES.reference, markers: false, reference: true, points: dense },
    { id: 'spr', label: 'FE, SPR recovery', color: SERIES.c1, line: false, points: points.map((p) => ({ x: p.y, y: p.spr })) },
    { id: 'avg', label: 'FE, nodal average', color: SERIES.c2, line: false, points: points.map((p) => ({ x: p.y, y: p.average })) },
  ];

  return (
    <>
      <p>
        σx through the depth at midspan, x = L/2, on the clamped model with 16 cells through the depth. Stress is read
        away from the wall, where the clamped corners are singular. The interior matches the linear distribution
        closely. At the surfaces, nodal averaging is one-sided and reads low; SPR extrapolates the gradient to the
        surface and halves that error.
      </p>
      <Chart
        title="Bending stress through the depth at midspan"
        summary={`At the top surface the exact stress is ${formatNumber(top.exact)} MPa; SPR gives ${formatNumber(top.spr)} and nodal averaging ${formatNumber(top.average)}.`}
        x={{ label: 'Height above the neutral axis y (mm)' }}
        y={{ label: 'σx (MPa)' }}
        series={series}
      />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>y (mm)</th>
              <th>Exact (MPa)</th>
              <th>SPR (MPa)</th>
              <th>Nodal average (MPa)</th>
            </tr>
          </thead>
          <tbody>
            {[points[0], points[Math.floor(points.length / 4)], points[Math.floor(points.length / 2)], points[Math.floor((3 * points.length) / 4)], top].map((p) => (
              <tr key={p.y}>
                <td>{formatNumber(p.y)}</td>
                <td>{formatNumber(p.exact, 4)}</td>
                <td>
                  {formatNumber(p.spr, 4)} <span className="muted">{relative(p.spr, p.exact)}</span>
                </td>
                <td>
                  {formatNumber(p.average, 4)} <span className="muted">{relative(p.average, p.exact)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
