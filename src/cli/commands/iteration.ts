import type { Backend } from '../../backends/types.js';

export interface IterationListResult {
  iterations: string[];
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
