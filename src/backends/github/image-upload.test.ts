import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { GitHubApiClient } from './api.js';
import { uploadImageToGitHub } from './image-upload.js';

type RestFn = GitHubApiClient['rest'];

function mockApi() {
  const rest = vi.fn<RestFn>();
  return { rest, api: { rest } as unknown as GitHubApiClient };
}

describe('uploadImageToGitHub', () => {
  const owner = 'test-owner';
  const repo = 'test-repo';
  const branch = 'main';
  const imageData = Buffer.from('fake-png-data');

  const expectedHash = createHash('sha256')
    .update(imageData)
    .digest('hex')
    .slice(0, 12);
  const expectedPath = `.github/tic-images/${expectedHash}.png`;

  function setupMockRest(rest: ReturnType<typeof vi.fn<RestFn>>) {
    rest
      .mockResolvedValueOnce({ sha: 'blob-sha-123' })
      .mockResolvedValueOnce({ object: { sha: 'commit-sha-abc' } })
      .mockResolvedValueOnce({ tree: { sha: 'tree-sha-def' } })
      .mockResolvedValueOnce({ sha: 'new-tree-sha-456' })
      .mockResolvedValueOnce({ sha: 'new-commit-sha-789' })
      .mockResolvedValueOnce(undefined);
  }

  it('creates blob, tree, commit and updates ref', async () => {
    const { rest, api } = mockApi();
    setupMockRest(rest);

    const url = await uploadImageToGitHub(api, owner, repo, branch, imageData);

    expect(url).toBe(
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${expectedPath}`,
    );

    // Verify all 6 API calls
    expect(rest).toHaveBeenCalledTimes(6);

    // 1. Create blob
    expect(rest).toHaveBeenNthCalledWith(
      1,
      'POST',
      `/repos/${owner}/${repo}/git/blobs`,
      { content: imageData.toString('base64'), encoding: 'base64' },
    );

    // 2. Get ref
    expect(rest).toHaveBeenNthCalledWith(
      2,
      'GET',
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    );

    // 3. Get commit
    expect(rest).toHaveBeenNthCalledWith(
      3,
      'GET',
      `/repos/${owner}/${repo}/git/commits/commit-sha-abc`,
    );

    // 4. Create tree
    expect(rest).toHaveBeenNthCalledWith(
      4,
      'POST',
      `/repos/${owner}/${repo}/git/trees`,
      {
        base_tree: 'tree-sha-def',
        tree: [
          {
            path: expectedPath,
            mode: '100644',
            type: 'blob',
            sha: 'blob-sha-123',
          },
        ],
      },
    );

    // 5. Create commit
    expect(rest).toHaveBeenNthCalledWith(
      5,
      'POST',
      `/repos/${owner}/${repo}/git/commits`,
      {
        message: `chore: add image ${expectedHash}.png via tic`,
        tree: 'new-tree-sha-456',
        parents: ['commit-sha-abc'],
      },
    );

    // 6. Update ref
    expect(rest).toHaveBeenNthCalledWith(
      6,
      'PATCH',
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      { sha: 'new-commit-sha-789' },
    );
  });

  it('uses content hash for deterministic filename', async () => {
    const { rest: rest1, api: api1 } = mockApi();
    const { rest: rest2, api: api2 } = mockApi();
    setupMockRest(rest1);
    setupMockRest(rest2);

    const url1 = await uploadImageToGitHub(
      api1,
      owner,
      repo,
      branch,
      imageData,
    );
    const url2 = await uploadImageToGitHub(
      api2,
      owner,
      repo,
      branch,
      imageData,
    );

    expect(url1).toBe(url2);
    expect(url1).toContain(expectedHash);
  });

  it('propagates API errors', async () => {
    const { rest, api } = mockApi();
    rest.mockRejectedValueOnce(new Error('API rate limited'));

    await expect(
      uploadImageToGitHub(api, owner, repo, branch, imageData),
    ).rejects.toThrow('API rate limited');
  });
});
