import { describe, it, expect } from 'vitest';
import type { PrBackend, PrCapabilities } from './types.js';

describe('PrCapabilities', () => {
  it('defines expected capability shape', () => {
    const caps: PrCapabilities = {
      pullRequests: true,
      merge: true,
      create: true,
    };
    expect(caps.pullRequests).toBe(true);
  });

  it('can represent a backend with no PR support', () => {
    const caps: PrCapabilities = {
      pullRequests: false,
      merge: false,
      create: false,
    };
    expect(caps.pullRequests).toBe(false);
  });
});

describe('PrBackend interface', () => {
  it('type-checks a mock implementation', () => {
    const mock: PrBackend = {
      getPrCapabilities: () => ({
        pullRequests: false,
        merge: false,
        create: false,
      }),
      listPullRequests: () => Promise.resolve([]),
      getPullRequest: () => Promise.resolve(null),
      createPullRequest: () => Promise.reject(new Error('not supported')),
      updatePullRequest: () => Promise.reject(new Error('not supported')),
      mergePullRequest: () => Promise.reject(new Error('not supported')),
      closePullRequest: () => Promise.reject(new Error('not supported')),
      getLinkedPullRequests: () => Promise.resolve([]),
      getLinkedItems: () => Promise.resolve([]),
      linkItem: () => Promise.resolve(),
      unlinkItem: () => Promise.resolve(),
    };
    expect(mock.getPrCapabilities().pullRequests).toBe(false);
  });
});
