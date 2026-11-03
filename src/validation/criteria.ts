// Pass/fail checks for the validation studies. The test suite asserts these
// and the validation page displays them, so "passing" means the same thing in
// both places.

import { convertKt, heywoodKt, KIRSCH_KT, ktLabel } from './analytical';
import type { ClampedWallRun, ConvergenceStudy } from './cases';
import { richardson } from './convergence';
import type { PlateRun } from './plate-cases';

export interface Check {
  label: string;
  measured: string;
  required: string;
  pass: boolean;
}

const pct = (v: number, digits = 2) => `${(100 * v).toFixed(digits)}%`.replace('-', '−');
const within = (value: number, lo: number, hi: number) => value > lo && value < hi;
const last = <T>(xs: readonly T[]) => xs[xs.length - 1];

/** Exact-wall cantilever: observed orders at the finest step, and the tip error there. */
export function cantileverChecks(study: ConvergenceStudy): Check[] {
  const { rates, runs } = study;
  const finest = last(runs);
  const order = (label: string, value: number, lo: number, hi: number, theory: number): Check => ({
    label: `${label} convergence order (theory ${theory})`,
    measured: value.toFixed(2),
    required: `${lo} to ${hi}`,
    pass: within(value, lo, hi),
  });
  return [
    order('Tip deflection', last(rates.tip), 1.9, 2.1, 2),
    order('L2 displacement', last(rates.displacementL2), 1.9, 2.1, 2),
    order('Energy norm', last(rates.energy), 0.95, 1.05, 1),
    {
      label: `Tip deflection error, ${finest.ny} cells through the depth`,
      measured: pct(finest.tipError),
      required: '< 0.3%',
      pass: finest.tipError < 0.003,
    },
  ];
}

/** Clamped cantilever: Richardson-extrapolated tip deflection against Timoshenko beam theory. */
export function clampedExtrapolation(coarse: ClampedWallRun, fine: ClampedWallRun) {
  const tip = richardson(coarse.tipDeflection, fine.tipDeflection, 2);
  return { tip, ratio: tip / fine.timoshenkoTipDeflection };
}

export function clampedChecks(coarse: ClampedWallRun, fine: ClampedWallRun): Check[] {
  const { ratio } = clampedExtrapolation(coarse, fine);
  return [
    {
      label: 'Extrapolated tip deflection vs Timoshenko beam (κ = 5/6)',
      measured: pct(ratio - 1),
      required: 'within ±0.5%',
      pass: Math.abs(ratio - 1) < 0.005,
    },
  ];
}

/** Wide plate (W/d = 10) on the gross basis. */
export function kirschChecks(run: PlateRun): Check[] {
  const kt = run.kt['spr-arc-fit'].gross;
  const heywoodGross = convertKt(heywoodKt(run.dOverW), 'gross', run.dOverW);
  return [
    {
      label: `${ktLabel('gross')} above Kirsch (finite width raises it)`,
      measured: pct(kt.value / KIRSCH_KT.value - 1),
      required: '0% to 2%',
      pass: within(kt.value / KIRSCH_KT.value - 1, 0, 0.02),
    },
    {
      label: `${ktLabel('gross')} vs Heywood (converted to gross)`,
      measured: pct(kt.value / heywoodGross.value - 1),
      required: 'within ±1%',
      pass: Math.abs(kt.value / heywoodGross.value - 1) < 0.01,
    },
  ];
}

/** Finite plate on the net basis. */
export function heywoodCheck(run: PlateRun): Check {
  const kt = run.kt['spr-arc-fit'].net;
  const ref = heywoodKt(run.dOverW);
  return {
    label: `${ktLabel('net')} vs Heywood, d/W = ${run.dOverW.toFixed(1)}`,
    measured: pct(kt.value / ref.value - 1),
    required: 'within ±2.5%',
    pass: Math.abs(kt.value / ref.value - 1) < 0.025,
  };
}

/** Net-section stress along the ligament against Kirsch, for a ≤ y − a ≤ 3a. */
export function ligamentCheck(run: PlateRun, a: number): Check {
  const near = run.ligament.filter((p) => p.y >= 1.2 * a && p.y <= 4 * a);
  const worst = Math.max(...near.map((p) => Math.abs(p.spr / p.kirsch - 1)));
  return {
    label: 'σxx/σ_gross along the net section vs Kirsch (1.2a ≤ y ≤ 4a)',
    measured: `max ${pct(worst)}`,
    required: '< 2.5%',
    pass: near.length > 5 && worst < 0.025,
  };
}

/**
 * 6-node LST on the exact-wall cantilever: theory gives O(h²) energy and O(h³)
 * L2 error, and it should beat CST by a wide margin at a fraction of the DOFs.
 * The tip error is not checked for an order: it reaches the PCG tolerance (~1e-8)
 * on fine meshes, which hides the discretisation error.
 */
export function lstCantileverChecks(lst: ConvergenceStudy, cst: ConvergenceStudy): Check[] {
  const coarsest = lst.runs[0];
  const finestCst = last(cst.runs);
  return [
    {
      label: 'LST energy-norm convergence order (theory 2)',
      measured: last(lst.rates.energy).toFixed(2),
      required: '1.9 to 2.1',
      pass: within(last(lst.rates.energy), 1.9, 2.1),
    },
    {
      label: 'LST L2 displacement convergence order (theory 3)',
      measured: last(lst.rates.displacementL2).toFixed(2),
      required: '2.8 to 3.4',
      pass: within(last(lst.rates.displacementL2), 2.8, 3.4),
    },
    {
      label: `LST tip error with ${coarsest.ny} cells (${coarsest.dofs} DOFs) below CST with ${finestCst.ny} cells (${finestCst.dofs.toLocaleString('en-US')} DOFs)`,
      measured: `${pct(coarsest.tipError, 3)} vs ${pct(finestCst.tipError, 3)}`,
      required: 'LST smaller',
      pass: coarsest.tipError < finestCst.tipError,
    },
  ];
}

/** LST plate with curved hole edges: K_t,g against Heywood (converted to gross). */
export function lstPlateCheck(run: PlateRun, elementsPerRadius: number): Check {
  const kt = run.kt['spr-arc-fit'].gross;
  const ref = convertKt(heywoodKt(run.dOverW), 'gross', run.dOverW);
  return {
    label: `LST ${ktLabel('gross')} vs Heywood (converted to gross), ${elementsPerRadius} elements per radius`,
    measured: pct(kt.value / ref.value - 1),
    required: 'within ±1%',
    pass: Math.abs(kt.value / ref.value - 1) < 0.01,
  };
}
