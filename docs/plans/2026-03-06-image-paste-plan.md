# Image Paste in Markdown Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow pasting images from clipboard into the markdown editor, uploading to GitHub via Git Data API, and inserting a markdown image link at the cursor.

**Architecture:** New `src/clipboard.ts` reads image data from system clipboard. New `src/backends/github/image-upload.ts` uploads image blobs to `.github/tic-images/` in the repo via GitHub's Git Data API (create blob → get ref → get commit → create tree → create commit → update ref). The editor store gets an async `pasteImage()` action with upload status. The MarkdownEditor component handles Ctrl+V to trigger the flow.

**Tech Stack:** Node.js `child_process` (clipboard access), GitHub REST API (Git Data), crypto (SHA-256 hashing), Zustand (editor state)

---

### Task 1: Clipboard Image Reading (`src/clipboard.ts`)

**Files:**
- Create: `src/clipboard.ts`
- Create: `src/clipboard.test.ts`

**Step 1: Write the failing test**

```typescript
// src/clipboard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readClipboardImage } from './clipboard.js';

// We mock execFileSync to control clipboard behavior
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';

const mockExecFileSync = vi.mocked(execFileSync);

describe('readClipboardImage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns PNG buffer on macOS when clipboard has image', () => {
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    // First call: pngpaste to temp file — succeeds
    mockExecFileSync.mockImplementationOnce(() => Buffer.alloc(0));
    // readFileSync is not mocked, so we need a different approach
    // Actually let's test the real platform detection with mocked exec
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockExecFileSync.mockReturnValueOnce(fakePng);

    const result = readClipboardImage();
    expect(result).toBeInstanceOf(Buffer);
    expect(result!.length).toBeGreaterThan(0);
  });

  it('returns null when clipboard has no image', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('no image');
    });

    const result = readClipboardImage();
    expect(result).toBeNull();
  });

  it('returns null on unsupported platform', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const result = readClipboardImage();
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/clipboard.test.ts`
Expected: FAIL — module `./clipboard.js` not found

**Step 3: Write minimal implementation**

```typescript
// src/clipboard.ts
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * Read image data from the system clipboard.
 * Returns a PNG Buffer if an image is on the clipboard, or null otherwise.
 */
export function readClipboardImage(): Buffer | null {
  try {
    if (process.platform === 'darwin') {
      return readClipboardImageMacOS();
    }
    if (process.platform === 'linux') {
      return readClipboardImageLinux();
    }
    return null;
  } catch {
    return null;
  }
}

function readClipboardImageMacOS(): Buffer | null {
  // pngpaste writes clipboard image to a file; exits non-zero if no image
  const tmpFile = join(tmpdir(), `tic-clip-${randomBytes(4).toString('hex')}.png`);
  try {
    execFileSync('pngpaste', [tmpFile], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const data = readFileSync(tmpFile);
    unlinkSync(tmpFile);
    return data.length > 0 ? data : null;
  } catch {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore
    }
    return null;
  }
}

function readClipboardImageLinux(): Buffer | null {
  try {
    const data = execFileSync(
      'xclip',
      ['-selection', 'clipboard', '-t', 'image/png', '-o'],
      { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 },
    );
    return Buffer.isBuffer(data) && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/clipboard.test.ts`
Expected: PASS (tests use mocked child_process)

**Step 5: Commit**

```bash
git add src/clipboard.ts src/clipboard.test.ts
git commit -m "feat: add clipboard image reading for macOS and Linux"
```

---

### Task 2: GitHub Image Upload (`src/backends/github/image-upload.ts`)

**Files:**
- Create: `src/backends/github/image-upload.ts`
- Create: `src/backends/github/image-upload.test.ts`

**Step 1: Write the failing test**

```typescript
// src/backends/github/image-upload.test.ts
import { describe, it, expect, vi } from 'vitest';
import { uploadImageToGitHub } from './image-upload.js';
import type { GitHubApiClient } from './api.js';

function mockApi(): GitHubApiClient {
  return {
    rest: vi.fn(),
  } as unknown as GitHubApiClient;
}

describe('uploadImageToGitHub', () => {
  it('creates blob, tree, commit and updates ref', async () => {
    const api = mockApi();
    const restMock = vi.mocked(api.rest);
    const imageData = Buffer.from('fake-png-data');

    // 1. Create blob → returns sha
    restMock.mockResolvedValueOnce({ sha: 'blob-sha-123' });
    // 2. Get ref → returns current commit sha
    restMock.mockResolvedValueOnce({ object: { sha: 'commit-sha-456' } });
    // 3. Get commit → returns tree sha
    restMock.mockResolvedValueOnce({ tree: { sha: 'tree-sha-789' } });
    // 4. Create tree → returns new tree sha
    restMock.mockResolvedValueOnce({ sha: 'new-tree-sha' });
    // 5. Create commit → returns new commit sha
    restMock.mockResolvedValueOnce({ sha: 'new-commit-sha' });
    // 6. Update ref → success
    restMock.mockResolvedValueOnce({});

    const url = await uploadImageToGitHub(api, 'owner', 'repo', 'main', imageData);

    expect(url).toContain('raw.githubusercontent.com');
    expect(url).toContain('owner/repo');
    expect(url).toContain('.github/tic-images/');
    expect(url).toEndWith('.png');

    // Verify blob creation with base64
    expect(restMock).toHaveBeenCalledWith('POST', '/repos/owner/repo/git/blobs', {
      content: imageData.toString('base64'),
      encoding: 'base64',
    });

    // Verify ref update
    expect(restMock).toHaveBeenCalledWith('PATCH', '/repos/owner/repo/git/refs/heads/main', {
      sha: 'new-commit-sha',
    });
  });

  it('uses content hash for filename', async () => {
    const api = mockApi();
    const restMock = vi.mocked(api.rest);
    const imageData = Buffer.from('test-image');

    restMock.mockResolvedValueOnce({ sha: 'blob-sha' });
    restMock.mockResolvedValueOnce({ object: { sha: 'commit-sha' } });
    restMock.mockResolvedValueOnce({ tree: { sha: 'tree-sha' } });
    restMock.mockResolvedValueOnce({ sha: 'new-tree-sha' });
    restMock.mockResolvedValueOnce({ sha: 'new-commit-sha' });
    restMock.mockResolvedValueOnce({});

    const url = await uploadImageToGitHub(api, 'owner', 'repo', 'main', imageData);

    // Same input should produce same hash
    const url2 = await uploadImageToGitHub(api, 'owner', 'repo', 'main', imageData);
    // Extract filename from both URLs
    const filename1 = url.split('/').pop();
    const filename2 = url2.split('/').pop();
    expect(filename1).toBe(filename2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/github/image-upload.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/backends/github/image-upload.ts
import { createHash } from 'node:crypto';
import type { GitHubApiClient } from './api.js';

/**
 * Upload an image to a GitHub repo by committing it to .github/tic-images/.
 * Returns the raw.githubusercontent.com URL for the uploaded image.
 */
export async function uploadImageToGitHub(
  api: GitHubApiClient,
  owner: string,
  repo: string,
  branch: string,
  imageData: Buffer,
): Promise<string> {
  const hash = createHash('sha256').update(imageData).digest('hex').slice(0, 12);
  const filePath = `.github/tic-images/${hash}.png`;

  // 1. Create blob
  const blob = await api.rest<{ sha: string }>(
    'POST',
    `/repos/${owner}/${repo}/git/blobs`,
    { content: imageData.toString('base64'), encoding: 'base64' },
  );

  // 2. Get current ref
  const ref = await api.rest<{ object: { sha: string } }>(
    'GET',
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
  );

  // 3. Get current commit to find base tree
  const commit = await api.rest<{ tree: { sha: string } }>(
    'GET',
    `/repos/${owner}/${repo}/git/commits/${ref.object.sha}`,
  );

  // 4. Create new tree with image file
  const tree = await api.rest<{ sha: string }>(
    'POST',
    `/repos/${owner}/${repo}/git/trees`,
    {
      base_tree: commit.tree.sha,
      tree: [
        {
          path: filePath,
          mode: '100644',
          type: 'blob',
          sha: blob.sha,
        },
      ],
    },
  );

  // 5. Create commit
  const newCommit = await api.rest<{ sha: string }>(
    'POST',
    `/repos/${owner}/${repo}/git/commits`,
    {
      message: `chore: add image ${hash}.png via tic`,
      tree: tree.sha,
      parents: [ref.object.sha],
    },
  );

  // 6. Update ref
  await api.rest(
    'PATCH',
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    { sha: newCommit.sha },
  );

  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/github/image-upload.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/github/image-upload.ts src/backends/github/image-upload.test.ts
git commit -m "feat: add GitHub image upload via Git Data API"
```

---

### Task 3: Expose GitHub owner/repo/branch from GitHubBackend

**Files:**
- Modify: `src/backends/github/index.ts`

The `owner`, `repo` fields are private. We need a way for the image upload to access them. Add a public method or expose a getter.

**Step 1: Write the failing test**

```typescript
// Add to src/backends/github/github.test.ts or a new test
// Actually, we just need to add getImageUploadInfo() and verify it returns the right shape.
// Since GitHubBackend uses a private constructor, we test via the existing test patterns.
```

Given that `GitHubBackend` has a private constructor and requires auth, the simplest approach is to add a public method that returns the info needed for image upload. We'll test this as part of the integration in Task 5.

**Step 2: Add public method to GitHubBackend**

Add after line 148 in `src/backends/github/index.ts`:

```typescript
  getImageUploadInfo(): { api: GitHubApiClient; owner: string; repo: string } {
    return { api: this.api, owner: this.owner, repo: this.repo };
  }
```

**Step 3: Add type guard for image upload support**

Add to `src/backends/github/index.ts` exports:

```typescript
export function isImageUploadBackend(
  backend: unknown,
): backend is GitHubBackend {
  return (
    backend !== null &&
    typeof backend === 'object' &&
    'getImageUploadInfo' in backend
  );
}
```

**Step 4: Commit**

```bash
git add src/backends/github/index.ts
git commit -m "feat: expose image upload info from GitHubBackend"
```

---

### Task 4: Editor Store — Upload Status and Paste Action

**Files:**
- Modify: `src/stores/editorStore.ts`

**Step 1: Add `uploadStatus` to EditorState interface**

Add to the `EditorState` interface (after line 30 `showDiscardPrompt: boolean;`):

```typescript
  uploadStatus: string | null;
```

Add to `initialState` (after line 89 `showDiscardPrompt: false,`):

```typescript
  uploadStatus: null,
```

Add to the `EditorState` interface methods section:

```typescript
  // Image paste
  insertText: (text: string) => void;
```

**Step 2: Add `insertText` method to the store**

This inserts arbitrary text at cursor (used by the paste-image flow to insert the markdown link). Add after the `insertTab` method:

```typescript
  insertText: (text: string) => {
    const { lines, cursor, undoStack } = get();
    const newUndo = [
      ...undoStack.slice(-(MAX_UNDO - 1)),
      { lines: [...lines], cursor: { ...cursor } },
    ];
    const line = lines[cursor.row]!;
    const newLine = line.slice(0, cursor.col) + text + line.slice(cursor.col);
    const newLines = [...lines];
    newLines[cursor.row] = newLine;
    set({
      lines: newLines,
      cursor: { row: cursor.row, col: cursor.col + text.length },
      undoStack: newUndo,
      redoStack: [],
      dirty: true,
    });
  },
```

**Step 3: Update `init` and `destroy` to reset `uploadStatus`**

Already handled by spreading `initialState` which includes `uploadStatus: null`.

**Step 4: Run existing tests to ensure nothing is broken**

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: PASS (no existing tests break)

**Step 5: Commit**

```bash
git add src/stores/editorStore.ts
git commit -m "feat: add uploadStatus and insertText to editor store"
```

---

### Task 5: MarkdownEditor — Handle Ctrl+V for Image Paste

**Files:**
- Modify: `src/components/MarkdownEditor.tsx`

**Step 1: Add imports**

Add at top of file:

```typescript
import { readClipboardImage } from '../clipboard.js';
import { uploadImageToGitHub } from '../backends/github/image-upload.js';
import { isImageUploadBackend } from '../backends/github/index.js';
import { backendDataStore } from '../stores/backendDataStore.js';
import { configStore } from '../stores/configStore.js';
import { uiStore } from '../stores/uiStore.js';
```

**Step 2: Subscribe to uploadStatus**

Add after the existing `useEditorStore` hooks (around line 22):

```typescript
  const uploadStatus = useEditorStore((s) => s.uploadStatus);
```

**Step 3: Add Ctrl+V handler in useInput**

Add after the Undo/Redo block (after line 83, before the Readline shortcuts):

```typescript
    // Paste image: Ctrl+V
    if (input === 'v' && key.ctrl) {
      const backendType = configStore.getState().config.backend;
      if (backendType !== 'github') return;

      const imageData = readClipboardImage();
      if (!imageData) return;

      // Find the remote backend for image upload
      const { currentRemoteBackend } = getRemoteBackend();
      if (!currentRemoteBackend || !isImageUploadBackend(currentRemoteBackend)) return;

      const { api, owner, repo } = currentRemoteBackend.getImageUploadInfo();
      editorStore.setState({ uploadStatus: 'Uploading image...' });

      // Get default branch name
      const branch = getDefaultBranch();

      uploadImageToGitHub(api, owner, repo, branch, imageData)
        .then((url) => {
          editorStore.getState().insertText(`![image](${url})`);
          editorStore.setState({ uploadStatus: null });
        })
        .catch((err: unknown) => {
          editorStore.setState({ uploadStatus: null });
          const msg = err instanceof Error ? err.message : 'Upload failed';
          uiStore.getState().setToast(`Image upload failed: ${msg}`);
        });
      return;
    }
```

We need a helper to get the remote backend. Since `currentRemoteBackend` is module-private in backendDataStore, we need to expose it. The simplest approach: add a getter to backendDataStore.

**Step 4: Expose `getRemoteBackend()` from backendDataStore**

In `src/stores/backendDataStore.ts`, add a module-level export function:

```typescript
export function getRemoteBackend(): Backend | null {
  return currentRemoteBackend;
}
```

**Step 5: Get default branch**

Add a helper function in MarkdownEditor (or use git):

```typescript
function getDefaultBranch(): string {
  try {
    const result = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result.replace('refs/remotes/origin/', '');
  } catch {
    return 'main';
  }
}
```

Actually, this should be in `src/git.ts` alongside other git helpers.

**Step 6: Add `getDefaultBranch()` to `src/git.ts`**

```typescript
export function getDefaultBranch(cwd?: string): string {
  try {
    const result = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result.replace('refs/remotes/origin/', '');
  } catch {
    return 'main';
  }
}
```

**Step 7: Update the Ctrl+V handler imports**

```typescript
import { getDefaultBranch } from '../git.js';
import { getRemoteBackend } from '../stores/backendDataStore.js';
```

And update the handler to use:

```typescript
      const remoteBackend = getRemoteBackend();
      if (!remoteBackend || !isImageUploadBackend(remoteBackend)) return;

      const { api, owner, repo } = remoteBackend.getImageUploadInfo();
      editorStore.setState({ uploadStatus: 'Uploading image...' });

      const branch = getDefaultBranch();

      uploadImageToGitHub(api, owner, repo, branch, imageData)
        .then((url) => {
          editorStore.getState().insertText(`![image](${url})`);
          editorStore.setState({ uploadStatus: null });
        })
        .catch((err: unknown) => {
          editorStore.setState({ uploadStatus: null });
          const msg = err instanceof Error ? err.message : 'Upload failed';
          uiStore.getState().setToast(`Image upload failed: ${msg}`);
        });
      return;
```

**Step 8: Show upload status in status bar**

Replace the status bar `<Text dimColor>` block (lines 231-234) with:

```tsx
        <Text dimColor>
          Ln {cursor.row + 1}, Col {cursor.col + 1}
          {dirty ? ' [modified]' : ''}
          {uploadStatus ? ` ${uploadStatus}` : ''}
        </Text>
```

**Step 9: Add Ctrl+V to help bar**

Update the help bar text (line 267):

```tsx
          <Text dimColor>
            Ctrl+S save Esc cancel Ctrl+V paste image Ctrl+Z undo Ctrl+U kill
            line Ctrl+Y yank Alt+↑↓ page Alt+←→ word
          </Text>
```

**Step 10: Run build to check for type errors**

Run: `npm run build`
Expected: PASS

**Step 11: Commit**

```bash
git add src/components/MarkdownEditor.tsx src/stores/backendDataStore.ts src/git.ts
git commit -m "feat: handle Ctrl+V image paste in markdown editor"
```

---

### Task 6: Full Integration Test

**Files:**
- Verify: Build, lint, format, existing tests

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Run lint and format**

Run: `npm run lint && npm run format:check`
Expected: Clean

**Step 3: Run build**

Run: `npm run build`
Expected: Clean

**Step 4: Fix any issues**

Address any lint/type/test failures.

**Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address lint/type issues in image paste feature"
```
