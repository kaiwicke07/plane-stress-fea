// FE cantilever against the exact solution and beam theory. These run the
// same validation cases as the site, so the tolerances here are what the site
// is allowed to show.

import { describe, expect, it } from 'vitest';
import { richardson } from '../../src/validation/convergence';
import { cantileverChecks, clampedChecks } from '../../src/validation/criteria';
import {
  cantileverConvergence,
  DEFAULT_CANTILEVER,
  runClampedWall,
  runExactWall,
} from '../../src/validation/cases';

const levels = [4, 8, 16, 32];

describe('cantilever with exact wall displacements', () => {
  const { runs, rates } = cantileverConvergence(DEFAULT_CANTILEVER, levels);

  it('reduces every error measure at each refinement', () => {
    for (let k = 1; k < runs.length; k++) {
      expect(runs[k].tipError).toBeLessThan(runs[k - 1].tipError);
      expect(runs[k].displacementL2).toBeLessThan(runs[k - 1].displacementL2);
      expect(runs[k].energy).toBeLessThan(runs[k - 1].energy);
    }
  });

  // The orders (theory 2, 2, 1) and the 0.3% tip-error limit are the shared
  // criteria the validation page displays.
  it.each(cantileverChecks({ runs, rates }))('$label: $measured (required $required)', (check) => {
    expect(check.pass).toBe(true);
  });

  it('approaches the exact tip deflection from below, since CST is too stiff', () => {
    const finest = runs[runs.length - 1];
    expect(finest.exactTipDeflection).toBeCloseTo(0.5, 12);
    expect(finest.tipDeflection).toBeLessThan(finest.exactTipDeflection);
  });

  it('is more accurate with alternating diagonals than with one diagonal direction', () => {
    expect(runExactWall(DEFAULT_CANTILEVER, 8, 'alternating').tipError).toBeLessThan(
      runExactWall(DEFAULT_CANTILEVER, 8, 'right').tipError,
    );
  });
});

describe('cantilever with a fully clamped wall', () => {
  const coarse = runClampedWall(DEFAULT_CANTILEVER, 16);
  const fine = runClampedWall(DEFAULT_CANTILEVER, 32);
  const converged = richardson(coarse.tipDeflection, fine.tipDeflection, 2);

  it.each(clampedChecks(coarse, fine))('$label: $measured (required $required)', (check) => {
    expect(check.pass).toBe(true);
  });

  it('deflects more than the exact-wall model, which suppresses wall shear rotation', () => {
    expect(converged).toBeGreaterThan(runExactWall(DEFAULT_CANTILEVER, 32).exactTipDeflection);
  });

  it('recovers midspan bending stress Mc/I at O(h), from below', () => {
    expect(fine.beamMidspanStress).toBeCloseTo(150, 12); // 1000·50·10 / 3333.3
    const coarseError = 1 - coarse.midspanStress / coarse.beamMidspanStress;
    const fineError = 1 - fine.midspanStress / fine.beamMidspanStress;
    expect(fineError).toBeGreaterThan(0); // boundary-node averaging under-predicts
    expect(fineError).toBeLessThan(0.05);
    const rate = Math.log2(coarseError / fineError);
    expect(rate).toBeGreaterThan(0.8);
    expect(rate).toBeLessThan(1.3);
    const extrapolated = richardson(coarse.midspanStress, fine.midspanStress, 1);
    expect(Math.abs(extrapolated / fine.beamMidspanStress - 1)).toBeLessThan(0.01);
  });
});
