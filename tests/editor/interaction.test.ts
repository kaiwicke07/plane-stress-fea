import { describe, expect, it } from 'vitest';
import { checkpoint, initHistory, pushHistory, redo, undo } from '../../src/editor/history';
import { deleteSelection, gridStep, hitTest, snapPoint } from '../../src/editor/interaction';
import { addCircleHole, emptyGeometry, setOutline } from '../../src/editor/model';

const geo = addCircleHole(
  setOutline(emptyGeometry(), [
    [0, 0],
    [100, 0],
    [100, 50],
    [0, 50],
  ]),
  50,
  25,
  10,
);

describe('hitTest', () => {
  it('prefers a vertex over the edges that meet there', () => {
    expect(hitTest(geo, [99, 1], 3)).toEqual({ kind: 'vertex', ref: { hole: undefined, index: 1 } });
  });

  it('finds the nearest edge and the closest point on it', () => {
    const hit = hitTest(geo, [40, 1.5], 3);
    expect(hit).toMatchObject({ kind: 'edge', edge: 'e1' });
    expect(hit?.kind === 'edge' && hit.at).toEqual([40, 0]);
  });

  it('distinguishes a circle centre from its edge', () => {
    expect(hitTest(geo, [51, 25], 2)).toEqual({ kind: 'circle-centre', hole: 'h5' });
    expect(hitTest(geo, [60.5, 25], 2)).toEqual({ kind: 'circle-edge', hole: 'h5', edge: 'h6' });
  });

  it('returns null away from everything', () => {
    expect(hitTest(geo, [25, 25], 2)).toBeNull();
  });
});

describe('deleteSelection', () => {
  it('deletes a selected corner, a hole, or the hole owning a selected edge', () => {
    expect(deleteSelection(geo, { kind: 'vertex', index: 0 }).outline.points.length).toBe(3);
    expect(deleteSelection(geo, { kind: 'hole', hole: 'h5' }).holes).toEqual([]);
    expect(deleteSelection(geo, { kind: 'edge', edge: 'h6' }).holes).toEqual([]);
  });

  it('leaves outline edges and an empty selection alone', () => {
    expect(deleteSelection(geo, { kind: 'edge', edge: 'e1' })).toBe(geo);
    expect(deleteSelection(geo, null)).toBe(geo);
  });
});

describe('grid', () => {
  it('picks 1–2–5 steps near the target spacing', () => {
    expect(gridStep(24)).toBe(1); // 24 px/mm → 1 mm
    expect(gridStep(6)).toBe(5); // 4 mm raw → 5
    expect(gridStep(0.5)).toBe(50); // 48 mm raw → 50
    expect(gridStep(100)).toBe(0.2); // 0.24 mm raw → 0.2
  });

  it('snaps cleanly, without float noise', () => {
    expect(snapPoint([0.31, 7.04], 0.1)).toEqual([0.3, 7]);
    expect(snapPoint([12.6, -2.4], 5)).toEqual([15, 0]);
  });
});

describe('history', () => {
  it('undoes and redoes, and a new edit clears the redo stack', () => {
    let h = initHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(pushHistory(undo(h), 9));
    expect(h.present).toBe(2);
    expect(redo(h).present).toBe(9);
  });

  it('records a drag as one step', () => {
    let h = checkpoint(initHistory(0)); // drag start
    h = pushHistory(h, 1, false);
    h = pushHistory(h, 2, false);
    expect(h.present).toBe(2);
    expect(undo(h).present).toBe(0);
  });
});
