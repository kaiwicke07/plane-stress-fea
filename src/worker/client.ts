import type { SolveJob, SolveResult, WorkerResponse } from './job';

export type JobInput = Omit<SolveJob, 'id'>;

/**
 * Runs solves in a Web Worker, one at a time, latest request wins: while a
 * solve is running, only the newest request is kept, and it starts as soon as
 * the current one finishes. Results of superseded requests are dropped.
 */
export class SolverClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private latestId = 0;
  private running = false;
  private pending: SolveJob | null = null;
  private readonly onResult: (result: SolveResult) => void;
  private readonly onError: (message: string) => void;
  private readonly onBusy: (busy: boolean) => void;

  constructor(
    onResult: (result: SolveResult) => void,
    onError: (message: string) => void,
    onBusy: (busy: boolean) => void,
  ) {
    this.onResult = onResult;
    this.onError = onError;
    this.onBusy = onBusy;
  }

  request(input: JobInput): void {
    const job = { ...input, id: this.nextId++ };
    this.latestId = job.id;
    if (this.running) {
      this.pending = job;
    } else {
      this.start(job);
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private start(job: SolveJob): void {
    this.running = true;
    this.onBusy(true);
    this.getWorker().postMessage(job);
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => this.handle(data);
      this.worker.onerror = (event) => {
        event.preventDefault();
        this.handle({ type: 'error', id: this.latestId, message: event.message || 'Solver worker crashed' });
      };
    }
    return this.worker;
  }

  private handle(response: WorkerResponse): void {
    this.running = false;
    const id = response.type === 'result' ? response.result.id : response.id;
    if (id === this.latestId) {
      if (response.type === 'result') this.onResult(response.result);
      else this.onError(response.message);
    }
    const next = this.pending;
    this.pending = null;
    if (next) this.start(next);
    else this.onBusy(false);
  }
}
