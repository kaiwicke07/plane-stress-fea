// Plate with a hole against Kirsch (gross basis) and Heywood (net basis).
// Stress definitions: docs/PLAN.md, "Plate with a hole: stress definitions".

import { describe, expect, it } from 'vitest';
import {
  convertKt,
  heywoodKt,
  KIRSCH_KT,
  kirschLigament,
  ktLabel,
} from '../../src/validation/analytical';
import { holeMesh, KIRSCH_PLATE, plateReferences, runPlate } from '../../src/validation/plate-cases';

describe('stress concentration references', () => {
  it('Kirsch gives K_t,g = 3 at the hole edge and decays to 1 far away', () => {
    expect(KIRSCH_KT).toEqual({ basis: 'gross', value: 3 });
    expect(kirschLigament(5, 5)).toBe(3);
    expect(kirschLigament(5, 500)).toBeCloseTo(1, 3); // 1 + ½·10⁻⁴ + …
  });

  it('Heywood is on the net basis and tends to 3 as d/W → 0', () => {
    expect(heywoodKt(0.2)).toEqual({ basis: 'net', value: 2 + 0.8 ** 3 });
    expect(heywoodKt(0).value).toBe(3);
  });

  it('converts between bases with σ_net = σ_gross · W/(W − d)', () => {
    // Worked example from the plan: d/W = 0.2 gives K_t,n ≈ 2.512, K_t,g ≈ 3.14.
    const gross = convertKt(heywoodKt(0.2), 'gross', 0.2);
    expect(gross.basis).toBe('gross');
    expect(gross.value).toBeCloseTo(3.14, 2);
    expect(convertKt(gross, 'net', 0.2).value).toBeCloseTo(2.512, 12);
    expect(convertKt(gross, 'gross', 0.2)).toBe(gross);
  });

  it('labels come from the basis', () => {
    expect(ktLabel('gross')).toMatch(/gross/);
    expect(ktLabel('net')).toMatch(/net/);
  });
});

describe('wide plate (W/d = 10) against Kirsch, gross basis', { timeout: 60_000 }, () => {
  const coarse = runPlate(KIRSCH_PLATE, holeMesh(KIRSCH_PLATE, 16));
  const fine = runPlate(KIRSCH_PLATE, holeMesh(KIRSCH_PLATE, 32));
  const refs = plateReferences(0.1);

  it('produces converged, good-quality meshes', () => {
    expect(fine.minAngle).toBeGreaterThan(25);
    expect(fine.dofs).toBeGreaterThan(coarse.dofs);
  });

  it('reports every K_t with its basis', () => {
    for (const recovery of Object.values(fine.kt)) {
      expect(recovery.gross.basis).toBe('gross');
      expect(recovery.net.basis).toBe('net');
      expect(recovery.net.value).toBeCloseTo(recovery.gross.value * 0.9, 12);
    }
  });

  it('K_t,g sits 0–2% above Kirsch, as finite width predicts, and within 1% of Heywood (converted to gross)', () => {
    const kt = fine.kt['spr-arc-fit'].gross.value;
    expect(kt / KIRSCH_KT.value - 1).toBeGreaterThan(0);
    expect(kt / KIRSCH_KT.value - 1).toBeLessThan(0.02);
    expect(Math.abs(kt / refs.heywoodAsGross.value - 1)).toBeLessThan(0.01);
  });

  it('gets closer to the reference with refinement', () => {
    const error = (run: typeof fine) => Math.abs(run.kt['spr-arc-fit'].gross.value / refs.heywoodAsGross.value - 1);
    expect(error(fine)).toBeLessThan(error(coarse));
  });

  it('follows the Kirsch decay along the net section', () => {
    const a = KIRSCH_PLATE.holeDiameter / 2;
    const near = fine.ligament.filter((p) => p.y >= 1.2 * a && p.y <= 4 * a);
    expect(near.length).toBeGreaterThan(5);
    for (const p of near) expect(Math.abs(p.spr / p.kirsch - 1)).toBeLessThan(0.025);
  });
});

describe('finite plates against Heywood, net basis', { timeout: 60_000 }, () => {
  for (const dOverW of [0.3, 0.5]) {
    it(`d/W = ${dOverW}: K_t,n within 2.5% of Heywood's empirical fit`, () => {
      const params = { ...KIRSCH_PLATE, width: 50, length: 100, holeDiameter: 50 * dOverW };
      const run = runPlate(params, holeMesh(params, 32));
      const kt = run.kt['spr-arc-fit'].net;
      expect(kt.basis).toBe('net');
      expect(Math.abs(kt.value / heywoodKt(dOverW).value - 1)).toBeLessThan(0.025);
    });
  }
});
