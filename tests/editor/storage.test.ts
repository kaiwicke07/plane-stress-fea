import { describe, expect, it } from 'vitest';
import { parseGeometry } from '../../src/editor/storage';
import { TEMPLATES } from '../../src/editor/templates';

describe('parseGeometry', () => {
  it('round-trips every template through JSON', () => {
    for (const t of TEMPLATES) {
      const geo = t.build();
      expect(parseGeometry(JSON.parse(JSON.stringify(geo)))).toEqual(geo);
    }
  });

  it('rejects malformed data instead of crashing later', () => {
    const geo = JSON.parse(JSON.stringify(TEMPLATES[0].build()));
    expect(parseGeometry(null)).toBeNull();
    expect(parseGeometry({ ...geo, holes: 'nope' })).toBeNull();
    expect(parseGeometry({ ...geo, outline: { points: [[0, 'x']], edges: ['e1'] } })).toBeNull();
    expect(parseGeometry({ ...geo, outline: { ...geo.outline, edges: ['e1'] } })).toBeNull(); // length mismatch
    expect(parseGeometry({ ...geo, conditions: { e1: { support: 'glued' } } })).toBeNull();
    expect(parseGeometry({ ...geo, conditions: { e1: { load: { kind: 'force', fx: 1 } } } })).toBeNull();
  });

  it('never reuses an ID, even if the stored counter is stale', () => {
    const geo = JSON.parse(JSON.stringify(TEMPLATES[0].build()));
    const parsed = parseGeometry({ ...geo, nextId: 1 });
    expect(parsed?.nextId).toBe(geo.nextId);
  });
});
