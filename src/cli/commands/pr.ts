import type { Backend } from '../../backends/types.js';
import { isPrBackend } from '../../backends/types.js';
import type { PullRequest, NewPullRequest } from '../../types.js';

export interface PrListOptions {
  status?: string;
}

export interface PrCreateOptions {
  title: string;
  source: string;
  target?: string;
  link?: string;
}

function requirePrBackend(backend: Backend) {
  if (!isPrBackend(backend)) {
    throw new Error(
      'Pull request operations require a PR-capable backend (e.g., GitHub)',
    );
  }
  return backend;
}

export async function runPrList(
  backend: Backend,
  opts: PrListOptions,
): Promise<PullRequest[]> {
  const prBackend = requirePrBackend(backend);
  let prs = await prBackend.listPullRequests();
  if (opts.status) {
    prs = prs.filter((pr) => pr.status === opts.status);
  }
  return prs;
}

export async function runPrShow(
  backend: Backend,
  id: string,
): Promise<PullRequest> {
  const prBackend = requirePrBackend(backend);
  const pr = await prBackend.getPullRequest(id);
  if (!pr) {
    throw new Error(`Pull request ${id} not found`);
  }
  return pr;
}

export async function runPrCreate(
  backend: Backend,
  opts: PrCreateOptions,
): Promise<PullRequest> {
  const prBackend = requirePrBackend(backend);
  const caps = prBackend.getPrCapabilities();
  if (!caps.create) {
    throw new Error('This backend does not support creating pull requests');
  }
  const newPr: NewPullRequest = {
    title: opts.title,
    sourceBranch: opts.source,
    targetBranch: opts.target,
    linkedItems: opts.link
      ? opts.link
          .split(',')
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
      : [],
  };
  return prBackend.createPullRequest(newPr);
}

export async function runPrMerge(
  backend: Backend,
  id: string,
): Promise<PullRequest> {
  const prBackend = requirePrBackend(backend);
  const caps = prBackend.getPrCapabilities();
  if (!caps.merge) {
    throw new Error('This backend does not support merging pull requests');
  }
  return prBackend.mergePullRequest(id);
}

export async function runPrClose(
  backend: Backend,
  id: string,
): Promise<PullRequest> {
  const prBackend = requirePrBackend(backend);
  return prBackend.closePullRequest(id);
}

export async function runPrOpen(backend: Backend, id: string): Promise<void> {
  const prBackend = requirePrBackend(backend);
  const pr = await prBackend.getPullRequest(id);
  if (!pr) {
    throw new Error(`Pull request ${id} not found`);
  }
  if (!pr.url) {
    throw new Error(`Pull request ${id} has no URL`);
  }
  const open = (await import('open')).default;
  await open(pr.url);
}

export async function runPrLink(
  backend: Backend,
  prId: string,
  itemId: string,
): Promise<void> {
  const prBackend = requirePrBackend(backend);
  await prBackend.linkItem(prId, itemId);
}

export async function runPrUnlink(
  backend: Backend,
  prId: string,
  itemId: string,
): Promise<void> {
  const prBackend = requirePrBackend(backend);
  await prBackend.unlinkItem(prId, itemId);
}
