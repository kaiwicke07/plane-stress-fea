import { convertKt, heywoodKt, ktLabel } from '../../validation/analytical';
import type { ConvergenceStudy } from '../../validation/cases';
import { lstCantileverChecks, lstPlateCheck } from '../../validation/criteria';
import { KIRSCH_PLATE, type PlateRun, RECOVERY_LABEL } from '../../validation/plate-cases';
import { Chart, type ChartSeries } from '../charts/Chart';
import { CheckList } from './CheckList';
import { pct, SERIES } from './series';

export function LstCantilever({ lst, cst }: { lst: ConvergenceStudy; cst: ConvergenceStudy }) {
  const versus = (measure: 'energy' | 'tipError'): ChartSeries[] => [
    { id: 'lst', label: 'LST, 6-node', color: SERIES.c1, points: lst.runs.map((r) => ({ x: r.dofs, y: r[measure] })) },
    { id: 'cst', label: 'CST, 3-node', color: SERIES.c2, points: cst.runs.map((r) => ({ x: r.dofs, y: r[measure] })) },
  ];
  const coarsest = lst.runs[0];
  const finestCst = cst.runs[cst.runs.length - 1];

  return (
    <>
      <p>
        The same exact-wall cantilever with 6-node linear strain triangles. Quadratic displacement means linear strain
        inside each element, so bending is represented instead of approximated by steps. Theory: energy-norm error
        O(h²) and L2 error O(h³), one order better than CST in each. Plotted against degrees of freedom, so the
        comparison is per unit of computing cost.
      </p>
      <p>
        With {coarsest.ny} cells through the depth ({coarsest.dofs} DOFs), LST's tip error is {pct(coarsest.tipError)}.
        CST needs {finestCst.ny} cells ({finestCst.dofs.toLocaleString()} DOFs) to reach {pct(finestCst.tipError)}. On fine
        meshes the LST tip error reaches the solver's convergence tolerance, about 10⁻⁸, so its last points flatten.
      </p>
      <div className="chart-grid-2">
        <Chart
          title="Energy-norm error vs DOFs"
          summary="LST's energy-norm error is far below CST's at every DOF count, and falls twice as fast."
          x={{ label: 'Degrees of freedom', scale: 'log' }}
          y={{ label: 'Relative energy-norm error', scale: 'log', format: (v) => pct(v, 2) }}
          series={versus('energy')}
        />
        <Chart
          title="Tip deflection error vs DOFs"
          summary="LST's tip deflection error is orders of magnitude below CST's at the same DOF count."
          x={{ label: 'Degrees of freedom', scale: 'log' }}
          y={{ label: 'Relative tip error', scale: 'log', format: (v) => pct(v, 2) }}
          series={versus('tipError')}
        />
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>LST cells through depth</th>
              <th>DOFs</th>
              <th>Tip error</th>
              <th>L2 error</th>
              <th>Energy error</th>
              <th>Order (L2 / energy)</th>
            </tr>
          </thead>
          <tbody>
            {lst.runs.map((r, i) => (
              <tr key={r.ny}>
                <td>{r.ny}</td>
                <td>{r.dofs.toLocaleString()}</td>
                <td>{pct(r.tipError)}</td>
                <td>{pct(r.displacementL2)}</td>
                <td>{pct(r.energy)}</td>
                <td>
                  {i === 0
                    ? '—'
                    : `${lst.rates.displacementL2[i - 1].toFixed(2)} / ${lst.rates.energy[i - 1].toFixed(2)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CheckList checks={lstCantileverChecks(lst, cst)} />
    </>
  );
}

export function LstPlate({ lst, cst }: { lst: PlateRun[]; cst: PlateRun[] }) {
  const a = KIRSCH_PLATE.holeDiameter / 2;
  const k = (run: PlateRun) => Math.round(a / run.hHole);
  const dOverW = lst[0].dOverW;
  const ref = convertKt(heywoodKt(dOverW), 'gross', dOverW);
  const cstAt = (level: number) => cst.find((r) => k(r) === level);
  const diff = (v: number) => pct(v / ref.value - 1, 2);

  return (
    <>
      <p>
        The wide plate (W/d = {Math.round(1 / dOverW)}) with 6-node elements. Mid-side nodes on the hole are placed on the
        true circle, so the hole edge is curved rather than a polygon. Differences are against Heywood's value
        converted to the <strong>gross</strong> basis, K_t,g = {ref.value.toFixed(3)}.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Elements per radius</th>
              <th>LST DOFs</th>
              <th>
                LST {ktLabel('gross')}, {RECOVERY_LABEL['spr-arc-fit']}
              </th>
              <th>LST, {RECOVERY_LABEL.average}</th>
              <th>CST, {RECOVERY_LABEL['spr-arc-fit']}</th>
            </tr>
          </thead>
          <tbody>
            {lst.map((r) => {
              const c = cstAt(k(r));
              return (
                <tr key={k(r)}>
                  <td>{k(r)}</td>
                  <td>{r.dofs.toLocaleString()}</td>
                  <td>
                    {r.kt['spr-arc-fit'].gross.value.toFixed(3)} <span className="muted">({diff(r.kt['spr-arc-fit'].gross.value)})</span>
                  </td>
                  <td>
                    {r.kt.average.gross.value.toFixed(3)} <span className="muted">({diff(r.kt.average.gross.value)})</span>
                  </td>
                  <td>
                    {c ? (
                      <>
                        {c.kt['spr-arc-fit'].gross.value.toFixed(3)}{' '}
                        <span className="muted">({diff(c.kt['spr-arc-fit'].gross.value)})</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CheckList checks={[lstPlateCheck(lst[lst.length - 1], k(lst[lst.length - 1]))]} />
    </>
  );
}
