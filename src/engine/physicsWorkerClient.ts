import { GridState, SimulationAnalytics } from '../types/simulation';
import { StepParams, simulateStep } from './physics';
import { WorkerMessageRequest, WorkerMessageResponse } from '../workers/physicsWorker';

export class PhysicsWorkerClient {
  private worker: Worker | null = null;
  private isBusy: boolean = false;
  private pendingResolve: ((res: { nextState: GridState; analytics: SimulationAnalytics }) => void) | null = null;

  constructor() {
    try {
      if (typeof window !== 'undefined' && window.Worker) {
        this.worker = new Worker(
          new URL('../workers/physicsWorker.ts', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = (e: MessageEvent<WorkerMessageResponse>) => {
          if (e.data.type === 'SIMULATION_RESULT') {
            this.isBusy = false;
            if (this.pendingResolve) {
              this.pendingResolve(e.data.payload);
              this.pendingResolve = null;
            }
          }
        };

        this.worker.onerror = (err) => {
          console.warn('Physics Web Worker error, falling back to main thread:', err);
          this.isBusy = false;
          this.worker = null;
        };
      }
    } catch (e) {
      console.warn('Failed to initialize Physics Worker, falling back to main thread:', e);
      this.worker = null;
    }
  }

  /**
   * Run simulation step asynchronously
   */
  public async step(
    state: GridState,
    params: StepParams
  ): Promise<{ nextState: GridState; analytics: SimulationAnalytics }> {
    if (!this.worker) {
      // Fallback: synchronous execution on main thread
      return simulateStep(state, params);
    }

    if (this.isBusy) {
      // Worker still calculating previous step, use main thread to avoid stalling
      return simulateStep(state, params);
    }

    this.isBusy = true;
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      const request: WorkerMessageRequest = {
        type: 'SIMULATE_STEP',
        payload: { state, params },
      };
      this.worker!.postMessage(request);
    });
  }

  public terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
