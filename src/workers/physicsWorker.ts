import { simulateStep, StepParams } from '../engine/physics';
import { GridState, SimulationAnalytics } from '../types/simulation';

export interface WorkerMessageRequest {
  type: 'SIMULATE_STEP';
  payload: {
    state: GridState;
    params: StepParams;
  };
}

export interface WorkerMessageResponse {
  type: 'SIMULATION_RESULT';
  payload: {
    nextState: GridState;
    analytics: SimulationAnalytics;
  };
}

self.onmessage = (event: MessageEvent<WorkerMessageRequest>) => {
  const { type, payload } = event.data;

  if (type === 'SIMULATE_STEP') {
    try {
      const result = simulateStep(payload.state, payload.params);
      const response: WorkerMessageResponse = {
        type: 'SIMULATION_RESULT',
        payload: result,
      };
      self.postMessage(response);
    } catch (err: any) {
      console.error('Web Worker simulation error:', err);
    }
  }
};
