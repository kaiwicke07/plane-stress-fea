// Undo/redo over immutable values.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 100;

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * Sets a new present value. With `commit` false the change replaces the
 * present without an undo step, for continuous edits like dragging; call
 * checkpoint() when the drag begins so the whole drag undoes in one step.
 */
export function pushHistory<T>(h: History<T>, next: T, commit = true): History<T> {
  if (next === h.present) return h;
  if (!commit) return { ...h, present: next };
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}

/** Records the present as an undo step without changing it, at the start of a drag. */
export function checkpoint<T>(h: History<T>): History<T> {
  return { past: [...h.past, h.present].slice(-LIMIT), present: h.present, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
