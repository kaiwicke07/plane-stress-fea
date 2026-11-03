// FE cantilever against the exact solution and beam theory. These run the
// same validation cases as the site, so the tolerances here are what the site
// is allowed to show.

import { describe, expect, it } from 'vitest';
import { richardson } from '../../src/validation/convergence';
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

  it('converges at the theoretical CST rates: O(h²) displacement, O(h) energy', () => {
    const last = rates.tip.length - 1;
    expect(rates.tip[last]).toBeGreaterThan(1.9);
    expect(rates.tip[last]).toBeLessThan(2.1);
    expect(rates.displacementL2[last]).toBeGreaterThan(1.9);
    expect(rates.displacementL2[last]).toBeLessThan(2.1);
    expect(rates.energy[last]).toBeGreaterThan(0.95);
    expect(rates.energy[last]).toBeLessThan(1.05);
  });

  it('matches the exact tip deflection to 0.3% on the finest mesh', () => {
    const finest = runs[runs.length - 1];
    expect(finest.exactTipDeflection).toBeCloseTo(0.5, 12);
    expect(finest.tipError).toBeLessThan(0.003);
    expect(finest.tipDeflection).toBeLessThan(finest.exactTipDeflection); // CST is too stiff
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

  it('converges to Timoshenko beam theory within 0.5%', () => {
    expect(Math.abs(converged / fine.timoshenkoTipDeflection - 1)).toBeLessThan(0.005);
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
