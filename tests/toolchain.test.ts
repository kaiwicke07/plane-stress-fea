import { describe, expect, it } from 'vitest';

// Placeholder that proves Vitest + TypeScript run in CI. Replaced by real
// solver tests in Phase 1.
describe('toolchain', () => {
  it('does IEEE-754 double arithmetic in Float64Array', () => {
    const a = new Float64Array([0.1, 0.2]);
    expect(a[0] + a[1]).toBeCloseTo(0.3, 15);
  });
});
