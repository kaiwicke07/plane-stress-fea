import { convertKt, heywoodKt, KIRSCH_KT, kirschLigament, ktLabel } from '../../validation/analytical';
import { heywoodCheck, kirschChecks, ligamentCheck } from '../../validation/criteria';
import { KIRSCH_PLATE, type PlateRun, RECOVERY_LABEL } from '../../validation/plate-cases';
import { Chart, type ChartSeries } from '../charts/Chart';
import { formatNumber } from '../format';
import { CheckList } from './CheckList';
import { pct, SERIES } from './series';

const a = KIRSCH_PLATE.holeDiameter / 2;
const kt = (v: number) => v.toFixed(3);
/** Elements per hole radius, recovered from the hole-edge element size. */
const elementsPerRadius = (run: PlateRun, radius: number) => Math.round(radius / run.hHole);

export function StressDefinitions() {
  return (
    <div className="definitions">
      <p>
        Kirsch and Heywood normalise the peak stress by <strong>different reference stresses</strong>. Every number below
        says which one it uses, and a value converted from one basis to the other is labelled as converted.
      </p>
      <dl>
        <dt>σ_gross = P / (W·t)</dt>
        <dd>Far-field stress: the applied traction.</dd>
        <dt>σ_net = P / ((W − d)·t)</dt>
        <dd>Mean stress on the net section through the hole, σ_gross · W / (W − d).</dd>
        <dt>σ_max</dt>
        <dd>σxx at the hole edge on the net section. It equals the hoop stress there.</dd>
        <dt>{ktLabel('gross')}</dt>
        <dd>σ_max / σ_gross. Kirsch (infinite plate): 3.</dd>
        <dt>{ktLabel('net')}</dt>
        <dd>σ_max / σ_net = K_t,g · (1 − d/W). Heywood (finite width, empirical): 2 + (1 − d/W)³.</dd>
      </dl>
      <p className="muted">
        Model: a quarter plate with symmetry rollers on the cut edges, a graded DistMesh mesh, and σ_max taken from a
        least-squares fit of the SPR hoop stress along the hole edge (&quot;{RECOVERY_LABEL['spr-arc-fit']}&quot;).
        Single-node readings are shown alongside for comparison.
      </p>
    </div>
  );
}

export function KirschPlate({ runs }: { runs: PlateRun[] }) {
  const fine = runs[runs.length - 1];
  const dOverW = fine.dOverW;
  const heywoodGross = convertKt(heywoodKt(dOverW), 'gross', dOverW);
  const ks = runs.map((r) => elementsPerRadius(r, a));
  const span = [ks[0], ks[ks.length - 1]];
  const fe = (id: 'average' | 'spr' | 'spr-arc-fit', color: string): ChartSeries => ({
    id,
    label: `FE, ${RECOVERY_LABEL[id]}`,
    color,
    points: runs.map((r, i) => ({ x: ks[i], y: r.kt[id].gross.value })),
  });
  const ktSeries: ChartSeries[] = [
    fe('spr-arc-fit', SERIES.c1),
    fe('spr', SERIES.c3),
    fe('average', SERIES.c2),
    { id: 'kirsch', label: 'Kirsch, infinite plate (gross)', color: SERIES.reference, markers: false, reference: true, points: span.map((x) => ({ x, y: KIRSCH_KT.value })) },
    { id: 'heywood', label: 'Heywood, converted to gross', color: SERIES.guide, dash: '4 4', markers: false, reference: true, points: span.map((x) => ({ x, y: heywoodGross.value })) },
  ];

  const yMax = KIRSCH_PLATE.width / 2 / a;
  const kirschCurve = Array.from({ length: 80 }, (_, k) => 1 + (k * (yMax - 1)) / 79).map((r) => ({ x: r, y: kirschLigament(1, r) }));
  const ligamentSeries: ChartSeries[] = [
    { id: 'kirsch', label: 'Kirsch, infinite plate', color: SERIES.reference, markers: false, reference: true, points: kirschCurve },
    { id: 'fe', label: 'FE, SPR recovery', color: SERIES.c1, line: false, points: fine.ligament.map((p) => ({ x: p.y / a, y: p.spr })) },
  ];

  return (
    <>
      <p>
        Wide plate, W/d = {formatNumber(1 / dOverW)}, L = 2W, σ_gross = {KIRSCH_PLATE.stress} MPa. Compared on the{' '}
        <strong>gross</strong> basis, because Kirsch's 3 is relative to the far-field stress. Kirsch assumes an infinite
        plate. At this width Heywood predicts K_t,g {pct(heywoodGross.value / 3 - 1, 2)} above 3, so the FE value should
        sit slightly above Kirsch.
      </p>
      <div className="chart-grid-2">
        <Chart
          title={`${ktLabel('gross')} vs mesh refinement`}
          summary={`With ${ks[ks.length - 1]} elements per radius the fitted ${ktLabel('gross')} is ${kt(fine.kt['spr-arc-fit'].gross.value)}, against Kirsch 3 and Heywood converted to gross ${kt(heywoodGross.value)}.`}
          x={{ label: 'Elements per hole radius', scale: 'log', ticks: ks }}
          y={{ label: ktLabel('gross'), include: [KIRSCH_KT.value] }}
          series={ktSeries}
        />
        <Chart
          title="Net-section stress, σxx / σ_gross"
          summary="FE stress along the net section follows Kirsch's decay from 3 at the hole edge toward 1."
          x={{ label: 'Distance from hole centre, y / a' }}
          y={{ label: 'σxx / σ_gross', include: [1] }}
          series={ligamentSeries}
        />
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Elements per radius</th>
              <th>DOFs</th>
              <th>
                {ktLabel('gross')}, {RECOVERY_LABEL['spr-arc-fit']}
              </th>
              <th>
                {ktLabel('gross')}, {RECOVERY_LABEL.spr}
              </th>
              <th>
                {ktLabel('gross')}, {RECOVERY_LABEL.average}
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={ks[i]}>
                <td>{ks[i]}</td>
                <td>{r.dofs.toLocaleString()}</td>
                <td>{kt(r.kt['spr-arc-fit'].gross.value)}</td>
                <td>{kt(r.kt.spr.gross.value)}</td>
                <td>{kt(r.kt.average.gross.value)}</td>
              </tr>
            ))}
            <tr className="row-emphasis">
              <td colSpan={2}>References</td>
              <td colSpan={3}>
                Kirsch {kt(KIRSCH_KT.value)} (gross) · Heywood {kt(heywoodGross.value)} (net {kt(heywoodKt(dOverW).value)},
                converted to gross)
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <CheckList checks={[...kirschChecks(fine), ligamentCheck(fine, a)]} />
    </>
  );
}

export function HeywoodPlates({ runs }: { runs: PlateRun[] }) {
  const curve = Array.from({ length: 50 }, (_, k) => 0.05 + (k * 0.5) / 49).map((r) => ({ x: r, y: heywoodKt(r).value }));
  const series: ChartSeries[] = [
    { id: 'heywood', label: 'Heywood (net)', color: SERIES.reference, markers: false, reference: true, points: curve },
    { id: 'fit', label: `FE, ${RECOVERY_LABEL['spr-arc-fit']}`, color: SERIES.c1, line: false, points: runs.map((r) => ({ x: r.dOverW, y: r.kt['spr-arc-fit'].net.value })) },
    { id: 'avg', label: `FE, ${RECOVERY_LABEL.average}`, color: SERIES.c2, line: false, points: runs.map((r) => ({ x: r.dOverW, y: r.kt.average.net.value })) },
  ];

  return (
    <>
      <p>
        Finite plates, W = 50 mm, L = 2W, hole diameters from 5 to 25 mm, 32 elements per hole radius. Compared on the{' '}
        <strong>net</strong> basis, because Heywood's formula is relative to the net-section stress. Heywood is an
        empirical fit, so a percent or two at large d/W is not by itself evidence of FE error. The convergence study
        above is what establishes the FE accuracy.
      </p>
      <Chart
        title={`${ktLabel('net')} vs hole size`}
        summary={`FE ${ktLabel('net')} follows Heywood's curve from d/W = 0.1 to 0.5.`}
        x={{ label: 'd / W' }}
        y={{ label: ktLabel('net'), include: [2] }}
        series={series}
      />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>d / W</th>
              <th>DOFs</th>
              <th>Heywood {ktLabel('net')}</th>
              <th>FE {ktLabel('net')}</th>
              <th>Difference</th>
              <th>FE {ktLabel('gross')}</th>
              <th>Heywood, converted to gross</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const ref = heywoodKt(r.dOverW);
              const net = r.kt['spr-arc-fit'].net;
              return (
                <tr key={r.dOverW}>
                  <td>{r.dOverW.toFixed(1)}</td>
                  <td>{r.dofs.toLocaleString()}</td>
                  <td>{kt(ref.value)}</td>
                  <td>{kt(net.value)}</td>
                  <td>{pct(net.value / ref.value - 1, 2)}</td>
                  <td>{kt(r.kt['spr-arc-fit'].gross.value)}</td>
                  <td>{kt(convertKt(ref, 'gross', r.dOverW).value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CheckList checks={runs.map(heywoodCheck)} />
    </>
  );
}
