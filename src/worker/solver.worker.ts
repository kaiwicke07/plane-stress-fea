import { runJob, type SolveJob, transferables, type WorkerResponse } from './job';

// Typed against the DOM lib; in a worker, `self` has the worker postMessage signature.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SolveJob>) => void) | null;
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
};

scope.onmessage = ({ data: job }) => {
  try {
    const result = runJob(job);
    scope.postMessage({ type: 'result', result }, transferables(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.postMessage({ type: 'error', id: job.id, message }, []);
  }
};
