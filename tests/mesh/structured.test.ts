import { describe, expect, it } from 'vitest';
import { elementB } from '../../src/core/elements/cst';
import { RECT_EDGE, rectangleMesh } from '../../src/mesh/structured';
import { edgesWithTag, nodesWithTag } from '../../src/mesh/tagged-mesh';

describe('rectangleMesh', () => {
  for (const pattern of ['right', 'alternating'] as const) {
    it(`tiles the rectangle with counter-clockwise elements (${pattern})`, () => {
      const m = rectangleMesh({ x0: -1, y0: 2, width: 6, height: 3, nx: 4, ny: 3, pattern });
      expect(m.nodes.length / 2).toBe(5 * 4);
      expect(m.elements.length / 3).toBe(2 * 4 * 3);
      const B = new Float64Array(18);
      let area = 0;
      for (let e = 0; e < m.elements.length / 3; e++) area += elementB(m, e, B); // throws if clockwise
      expect(area).toBeCloseTo(18, 12);
    });
  }

  it('alternates the diagonal in a checkerboard', () => {
    const m = rectangleMesh({ width: 2, height: 1, nx: 2, ny: 1, pattern: 'alternating' });
    // Cell 0 uses diagonal 0–4, cell 1 uses diagonal 2–4.
    expect(Array.from(m.elements)).toEqual([0, 1, 4, 0, 4, 3, 1, 2, 4, 2, 5, 4]);
  });

  it('tags boundary edges by side, oriented with the material on the left', () => {
    const [nx, ny] = [3, 2];
    const m = rectangleMesh({ width: 3, height: 2, nx, ny });
    expect(m.boundaryTags.length).toBe(2 * (nx + ny));

    expect(nodesWithTag(m, RECT_EDGE.left)).toEqual([0, 4, 8]);
    expect(nodesWithTag(m, RECT_EDGE.right)).toEqual([3, 7, 11]);
    expect(nodesWithTag(m, RECT_EDGE.bottom)).toEqual([0, 1, 2, 3]);
    expect(nodesWithTag(m, RECT_EDGE.top)).toEqual([8, 9, 10, 11]);

    // Outward normal (Δy, −Δx) must point away from the rectangle on every side.
    const outward: [number, [number, number]][] = [
      [RECT_EDGE.bottom, [0, -1]],
      [RECT_EDGE.right, [1, 0]],
      [RECT_EDGE.top, [0, 1]],
      [RECT_EDGE.left, [-1, 0]],
    ];
    for (const [tag, [nx0, ny0]] of outward) {
      for (const [a, b] of edgesWithTag(m, tag)) {
        const dx = m.nodes[2 * b] - m.nodes[2 * a];
        const dy = m.nodes[2 * b + 1] - m.nodes[2 * a + 1];
        const length = Math.hypot(dx, dy);
        expect(dy / length).toBeCloseTo(nx0, 15);
        expect(-dx / length).toBeCloseTo(ny0, 15);
      }
    }
  });

  it('rejects invalid sizes', () => {
    expect(() => rectangleMesh({ width: 0, height: 1, nx: 1, ny: 1 })).toThrow(RangeError);
    expect(() => rectangleMesh({ width: 1, height: 1, nx: 0, ny: 1 })).toThrow(RangeError);
    expect(() => rectangleMesh({ width: 1, height: 1, nx: 1.5, ny: 1 })).toThrow(RangeError);
  });
});
