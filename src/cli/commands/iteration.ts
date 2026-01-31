import type { Backend } from '../../backends/types.js';

export interface IterationListResult {
  iterations: string[];
  current: string;
}

export function runIterationList(backend: Backend): IterationListResult {
  return {
    iterations: backend.getIterations(),
    current: backend.getCurrentIteration(),
  };
}

export function runIterationSet(backend: Backend, name: string): void {
  backend.setCurrentIteration(name);
}
