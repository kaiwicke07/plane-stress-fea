// Runs the validation suite off the main thread, posting each study's result
// as soon as it finishes so the page fills in progressively.

import { SUITE, SUITE_ORDER, type SuiteKey, type SuiteResults } from '../validation/suite';

export type ValidationMessage =
  | { type: 'started'; key: SuiteKey }
  | { type: 'result'; key: SuiteKey; result: NonNullable<SuiteResults[SuiteKey]>; ms: number }
  | { type: 'error'; key: SuiteKey; message: string }
  | { type: 'done' };

const scope = self as unknown as {
  onmessage: (() => void) | null;
  postMessage(message: ValidationMessage): void;
};

scope.onmessage = () => {
  for (const key of SUITE_ORDER) {
    scope.postMessage({ type: 'started', key });
    const t0 = performance.now();
    try {
      const result = SUITE[key]();
      scope.postMessage({ type: 'result', key, result, ms: performance.now() - t0 });
    } catch (error) {
      scope.postMessage({ type: 'error', key, message: error instanceof Error ? error.message : String(error) });
    }
  }
  scope.postMessage({ type: 'done' });
};
