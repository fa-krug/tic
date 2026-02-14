import { describe, it, expect } from 'vitest';

describe('PullRequestList', () => {
  it('exports the component', async () => {
    const mod = await import('./PullRequestList.js');
    expect(mod.PullRequestList).toBeDefined();
  });
});
