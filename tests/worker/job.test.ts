import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../../src/core/material';
import { defaultValues, PRESETS, presetById } from '../../src/presets';
import { autoDeformationScale, summarize } from '../../src/results/summary';
import { runJob, transferables } from '../../src/worker/job';

const steel = MATERIALS[0];

describe('presets through runJob', () => {
  for (const preset of PRESETS) {
    it(`${preset.name}: solves, balances and returns transferable buffers`, () => {
      const result = runJob({
        id: 7,
        source: { kind: 'preset', presetId: preset.id, values: defaultValues(preset) },
        density: 6,
        elementOrder: 1,
        material: steel,
        thickness: 5,
      });
      expect(result.id).toBe(7);
      const summary = summarize(result);
      expect(summary.equilibriumError).toBeLessThan(1e-6);
      expect(summary.maxDisplacement).toBeGreaterThan(0);
      expect(transferables(result).length).toBe(12);
    });
  }

  it('cantilever matches beam theory closely on a fine mesh', () => {
    const preset = presetById('cantilever');
    const values = { ...defaultValues(preset), load: 1000 };
    const result = runJob({ id: 1, source: { kind: 'preset', presetId: 'cantilever', values }, density: 16, elementOrder: 1, material: steel, thickness: 5 });
    const summary = summarize(result);
    // Tip moves ~0.51 mm (see the validation study); the peak stress M·c/I = 300 MPa
    // sits at the wall corners, which are singular, so only check it is in range.
    expect(summary.maxDisplacement).toBeGreaterThan(0.49);
    expect(summary.maxDisplacement).toBeLessThan(0.53);
    expect(summary.maxNodalVonMises).toBeGreaterThan(250);
    const peak = Math.max(summary.maxNodalVonMises, summary.maxElementVonMises, summary.maxSprVonMises);
    expect(summary.factorOfSafety).toBeCloseTo(steel.yieldStrength / peak, 12);
  });

  it('tension strip has the uniform uniaxial solution', () => {
    const preset = presetById('tension-strip');
    const result = runJob({ id: 1, source: { kind: 'preset', presetId: 'tension-strip', values: defaultValues(preset) }, density: 4, elementOrder: 1, material: steel, thickness: 5 });
    for (const vm of result.solution.elementVonMises) expect(vm).toBeCloseTo(100, 8);
    const summary = summarize(result);
    // Far corner moves by σ·L/E in x and −ν·σ·H/E in y.
    const [u, v] = [(100 * 100) / steel.E, (-steel.nu * 100 * 40) / steel.E];
    expect(summary.maxDisplacement).toBeCloseTo(Math.hypot(u, v), 12);
    expect(summary.factorOfSafety).toBeCloseTo(steel.yieldStrength / 100, 8);
  });

  it('auto-scales the largest displacement to 10% of the part size', () => {
    const preset = presetById('cantilever');
    const result = runJob({ id: 1, source: { kind: 'preset', presetId: 'cantilever', values: defaultValues(preset) }, density: 4, elementOrder: 1, material: steel, thickness: 5 });
    const scale = autoDeformationScale(result);
    expect(scale * summarize(result).maxDisplacement).toBeCloseTo(0.1 * 100, 10);
  });

  it('reports unknown presets', () => {
    expect(() => presetById('nope')).toThrow(/Unknown preset/);
  });
});

describe('6-node elements through runJob', () => {
  for (const preset of PRESETS) {
    it(`${preset.name}: solves with LST, in equilibrium, and transfers the mid-side nodes`, () => {
      const result = runJob({
        id: 1,
        source: { kind: 'preset', presetId: preset.id, values: defaultValues(preset) },
        density: 4,
        elementOrder: 2,
        material: steel,
        thickness: 5,
      });
      expect(result.mesh.midNodes?.length).toBe(result.mesh.elements.length);
      expect(summarize(result).equilibriumError).toBeLessThan(1e-6);
      expect(transferables(result).length).toBe(13);
    });
  }

  it('cantilever: LST on a coarse mesh is already near beam theory, CST is far off', () => {
    const preset = presetById('cantilever');
    const job = (elementOrder: 1 | 2) =>
      runJob({ id: 1, source: { kind: 'preset', presetId: 'cantilever', values: defaultValues(preset) }, density: 2, elementOrder, material: steel, thickness: 5 });
    // 500 N: beam theory (Timoshenko) gives about 0.258 mm.
    expect(summarize(job(2)).maxDisplacement).toBeGreaterThan(0.25);
    expect(summarize(job(1)).maxDisplacement).toBeLessThan(0.17);
  });
});
