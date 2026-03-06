import { createHash } from 'node:crypto';
import { GitHubApiClient } from './api.js';

export async function uploadImageToGitHub(
  api: GitHubApiClient,
  owner: string,
  repo: string,
  branch: string,
  imageData: Buffer,
): Promise<string> {
  const hash = createHash('sha256')
    .update(imageData)
    .digest('hex')
    .slice(0, 12);
  const filePath = `.github/tic-images/${hash}.png`;

  // 1. Create blob
  const { sha: blobSha } = await api.rest<{ sha: string }>(
    'POST',
    `/repos/${owner}/${repo}/git/blobs`,
    { content: imageData.toString('base64'), encoding: 'base64' },
  );

  // 2. Get current commit from ref
  const {
    object: { sha: currentCommitSha },
  } = await api.rest<{ object: { sha: string } }>(
    'GET',
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
  );

  // 3. Get tree from commit
  const {
    tree: { sha: treeSha },
  } = await api.rest<{ tree: { sha: string } }>(
    'GET',
    `/repos/${owner}/${repo}/git/commits/${currentCommitSha}`,
  );

  // 4. Create new tree
  const { sha: newTreeSha } = await api.rest<{ sha: string }>(
    'POST',
    `/repos/${owner}/${repo}/git/trees`,
    {
      base_tree: treeSha,
      tree: [{ path: filePath, mode: '100644', type: 'blob', sha: blobSha }],
    },
  );

  // 5. Create commit
  const { sha: newCommitSha } = await api.rest<{ sha: string }>(
    'POST',
    `/repos/${owner}/${repo}/git/commits`,
    {
      message: `chore: add image ${hash}.png via tic`,
      tree: newTreeSha,
      parents: [currentCommitSha],
    },
  );

  // 6. Update ref
  await api.rest('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    sha: newCommitSha,
  });

  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}
