import type { Backend } from '../../backends/types.js';
import type { Iteration } from '../../types.js';

export interface IterationListResult {
  iterations: Iteration[];
  current: string;
}

export async function runIterationList(
  backend: Backend,
): Promise<IterationListResult> {
  return {
    iterations: await backend.getIterations(),
    current: await backend.getCurrentIteration(),
  };
}

export async function runIterationSet(
  backend: Backend,
  name: string,
): Promise<void> {
  await backend.setCurrentIteration(name);
}
