import { useEffect, useRef, useState } from 'react';
import type { SuiteKey, SuiteResults } from '../../validation/suite';
import type { ValidationMessage } from '../../worker/validation.worker';

export type StudyStatus = { state: 'queued' } | { state: 'running' } | { state: 'done'; ms: number } | { state: 'failed'; message: string };

interface ValidationState {
  results: SuiteResults;
  status: Partial<Record<SuiteKey, StudyStatus>>;
  finished: boolean;
}

const EMPTY: ValidationState = { results: {}, status: {}, finished: false };

/** Runs the validation suite in a worker; results arrive study by study. */
export function useValidation() {
  const [state, setState] = useState<ValidationState>(EMPTY);
  const [runId, setRunId] = useState(0);
  const worker = useRef<Worker | null>(null);

  useEffect(() => {
    const w = new Worker(new URL('../../worker/validation.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = ({ data }: MessageEvent<ValidationMessage>) => {
      setState((s) => {
        switch (data.type) {
          case 'started':
            return { ...s, status: { ...s.status, [data.key]: { state: 'running' } } };
          case 'result':
            return {
              ...s,
              results: { ...s.results, [data.key]: data.result },
              status: { ...s.status, [data.key]: { state: 'done', ms: data.ms } },
            };
          case 'error':
            return { ...s, status: { ...s.status, [data.key]: { state: 'failed', message: data.message } } };
          case 'done':
            return { ...s, finished: true };
        }
      });
    };
    w.postMessage('run');
    return () => w.terminate();
  }, [runId]);

  const rerun = () => {
    setState(EMPTY);
    setRunId((n) => n + 1);
  };

  return { ...state, rerun };
}
