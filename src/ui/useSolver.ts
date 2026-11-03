import { useEffect, useRef, useState } from 'react';
import { type JobInput, SolverClient } from '../worker/client';
import type { SolveResult } from '../worker/job';

/**
 * Solves `input` in the worker whenever it changes (debounced). Keeps the last
 * good result on screen while a new one is computed or if it fails.
 * `input` must be memoised by the caller.
 */
export function useSolver(input: JobInput | null, debounceMs = 60) {
  const [result, setResult] = useState<SolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const client = useRef<SolverClient | null>(null);

  useEffect(() => {
    const c = new SolverClient(
      (r) => {
        setResult(r);
        setError(null);
      },
      setError,
      setBusy,
    );
    client.current = c;
    return () => c.dispose();
  }, []);

  useEffect(() => {
    if (!input) return;
    const timer = setTimeout(() => client.current?.request(input), debounceMs);
    return () => clearTimeout(timer);
  }, [input, debounceMs]);

  return { result, error, busy };
}
