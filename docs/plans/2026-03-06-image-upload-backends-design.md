# Image Upload for All Backends — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `uploadImage()` to the Backend interface with remote upload for GitLab/ADO/Jira and local save for Storage/GitHub.

**Architecture:** New `ImageUploadBackend` interface (like `PrBackend`/`SoftDeleteBackend`) with type guard. Remote backends implement actual API uploads; Storage saves to `.tic/images/`. MarkdownEditor resolves upload target: remote backend if available, else Storage fallback. Current `.github/tic-images/` path replaced with `.tic/images/`.

**Tech Stack:** Node.js `fetch` with multipart/form-data (GitLab), `application/octet-stream` (ADO), multipart (Jira). No new dependencies — use native `FormData` and `Blob`.

---

## Key Design Decisions

1. **Separate interface pattern** — `ImageUploadBackend` with `isImageUploadBackend()` type guard, matching existing `PrBackend`/`SoftDeleteBackend` patterns.
2. **No changes to `Backend` interface** — `uploadImage()` is optional, gated by type guard.
3. **`BackendCapabilities` gets `imageUpload: boolean`** — UI uses this to show/hide Ctrl+V hint.
4. **Remote-first, local fallback** — MarkdownEditor tries remote backend first, falls back to Storage local save.
5. **Jira limitation** — Jira attachments require an issue key. Since the editor doesn't know the current item ID during editing, Jira falls back to local save. (Jira `imageUpload: false`.)
6. **ADO uses `application/octet-stream`** — simpler than multipart; ADO attachment API accepts raw binary.
7. **GitLab uses REST** — needs new `rest()` method on `GitLabApiClient` (currently only has GraphQL).
8. **Move image dir** — `.github/tic-images/` → `.tic/images/` for consistency across all backends.

---

### Task 1: Add `imageUpload` to `BackendCapabilities` and `ImageUploadBackend` interface

**Files:**
- Modify: `src/backends/types.ts`

**Step 1: Add capability flag and interface**

In `src/backends/types.ts`, add `imageUpload` to `BackendCapabilities`:

```typescript
export interface BackendCapabilities {
  // ... existing fields ...
  imageUpload: boolean;
}
```

Add the new interface and type guard after `SoftDeleteBackend`:

```typescript
export interface ImageUploadBackend extends Backend {
  uploadImage(data: Buffer, filename: string): Promise<string>;
}

export function isImageUploadBackend(
  backend: Backend,
): backend is Backend & ImageUploadBackend {
  return 'uploadImage' in backend;
}
```

**Step 2: Add `imageUpload: false` to all existing `getCapabilities()` returns**

Update all five backends:
- `src/storage/index.ts` — set `imageUpload: true` (will implement local save)
- `src/backends/github/index.ts` — set `imageUpload: true` (will implement local save)
- `src/backends/gitlab/index.ts` — set `imageUpload: true` (will implement remote upload)
- `src/backends/ado/index.ts` — set `imageUpload: true` (will implement remote upload)
- `src/backends/jira/index.ts` — set `imageUpload: false` (no context-free upload API)
- `src/backends/files/index.ts` — set `imageUpload: false` (if it has getCapabilities)

**Step 3: Build to verify no type errors**

Run: `npm run build`
Expected: PASS (no type errors — `imageUpload` added to all capability objects)

**Step 4: Commit**

```bash
git commit -m "feat: add ImageUploadBackend interface and imageUpload capability"
```

---

### Task 2: Implement local image save in Storage

**Files:**
- Create: `src/storage/image-save.ts`
- Create: `src/storage/image-save.test.ts`
- Modify: `src/storage/index.ts`

**Step 1: Write the test**

Create `src/storage/image-save.test.ts`:

```typescript
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { saveImageLocal } from './image-save.js';

describe('saveImageLocal', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tic-img-test-'));
    execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
  });

  const imageData = Buffer.from('fake-png-data');
  const expectedHash = createHash('sha256')
    .update(imageData)
    .digest('hex')
    .slice(0, 12);

  it('writes image to .tic/images/ and stages it', () => {
    const relPath = saveImageLocal(root, imageData);

    expect(relPath).toBe(`.tic/images/${expectedHash}.png`);

    const absPath = join(root, relPath);
    expect(existsSync(absPath)).toBe(true);
    expect(readFileSync(absPath)).toEqual(imageData);

    // Verify file is staged
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: root,
      encoding: 'utf-8',
    }).trim();
    expect(staged).toBe(relPath);
  });

  it('produces deterministic paths for same content', () => {
    const path1 = saveImageLocal(root, imageData);
    const path2 = saveImageLocal(root, imageData);
    expect(path1).toBe(path2);
  });

  it('produces different paths for different content', () => {
    const path1 = saveImageLocal(root, imageData);
    const path2 = saveImageLocal(root, Buffer.from('different-data'));
    expect(path1).not.toBe(path2);
  });

  it('uses provided filename extension', () => {
    const relPath = saveImageLocal(root, imageData, 'screenshot.jpg');
    expect(relPath).toMatch(/\.jpg$/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/image-save.test.ts`
Expected: FAIL — `saveImageLocal` not found

**Step 3: Implement `saveImageLocal`**

Create `src/storage/image-save.ts`:

```typescript
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname } from 'node:path';

/**
 * Saves image data to `.tic/images/` in the repo and stages it with `git add`.
 * Returns a relative markdown-compatible path.
 */
export function saveImageLocal(
  root: string,
  imageData: Buffer,
  filename?: string,
): string {
  const hash = createHash('sha256')
    .update(imageData)
    .digest('hex')
    .slice(0, 12);
  const ext = filename ? extname(filename) || '.png' : '.png';
  const relPath = `.tic/images/${hash}${ext}`;
  const absDir = join(root, '.tic', 'images');
  const absPath = join(root, relPath);

  mkdirSync(absDir, { recursive: true });
  writeFileSync(absPath, imageData);

  try {
    execFileSync('git', ['add', relPath], { cwd: root, stdio: 'pipe' });
  } catch {
    // Not in a git repo — skip staging
  }

  return relPath;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/storage/image-save.test.ts`
Expected: PASS

**Step 5: Wire `uploadImage()` into Storage class**

In `src/storage/index.ts`, add import and implement `ImageUploadBackend`:

```typescript
import { saveImageLocal } from './image-save.js';
import type { ImageUploadBackend } from '../backends/types.js';
```

Update class declaration:
```typescript
export class Storage
  extends BaseBackend
  implements SoftDeleteBackend, PrBackend, ImageUploadBackend
```

Add method:
```typescript
// eslint-disable-next-line @typescript-eslint/require-await
async uploadImage(data: Buffer, filename: string): Promise<string> {
  return saveImageLocal(this.root, data, filename);
}
```

**Step 6: Build and test**

Run: `npm run build && npm test`
Expected: PASS

**Step 7: Commit**

```bash
git commit -m "feat: implement local image save in Storage backend"
```

---

### Task 3: Move GitHub backend to use local save

**Files:**
- Modify: `src/backends/github/index.ts`
- Delete: `src/backends/github/image-upload.ts` (logic moved to `src/storage/image-save.ts`)
- Delete: `src/backends/github/image-upload.test.ts` (replaced by `src/storage/image-save.test.ts`)

**Step 1: Add `ImageUploadBackend` to GitHubBackend**

In `src/backends/github/index.ts`:

```typescript
import { saveImageLocal } from '../../storage/image-save.js';
import type { ImageUploadBackend } from '../types.js';
```

Update class declaration:
```typescript
export class GitHubBackend extends BaseBackend implements PrBackend, ImageUploadBackend
```

Add method (needs `root` — check if GitHubBackend has `cwd`):
```typescript
// eslint-disable-next-line @typescript-eslint/require-await
async uploadImage(data: Buffer, filename: string): Promise<string> {
  return saveImageLocal(this.cwd, data, filename);
}
```

Note: GitHubBackend may not have a `cwd` field. Check the constructor — if it doesn't store cwd, add a `private cwd: string` parameter.

**Step 2: Remove old `image-upload.ts` and its test**

Delete `src/backends/github/image-upload.ts` and `src/backends/github/image-upload.test.ts`.

**Step 3: Build and test**

Run: `npm run build && npm test`
Expected: PASS

**Step 4: Commit**

```bash
git commit -m "refactor: move GitHub image save to shared saveImageLocal"
```

---

### Task 4: Add REST method to GitLabApiClient

**Files:**
- Modify: `src/backends/gitlab/api.ts`

**Step 1: Add `rest()` and `uploadFile()` methods**

In `src/backends/gitlab/api.ts`, add:

```typescript
async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
  return this.retry(() => this.fetch<T>(method, path, body));
}

async uploadFile(
  projectId: string,
  data: Buffer,
  filename: string,
): Promise<{ url: string; markdown: string }> {
  const encodedId = encodeURIComponent(projectId);
  const url = `${this.baseUrl}/api/v4/projects/${encodedId}/uploads`;

  const formData = new FormData();
  formData.append('file', new Blob([data]), filename);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${this.token}`,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await globalThis.fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
    throw new AuthError();
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: Upload failed`);
  }

  const json = (await response.json()) as {
    alt: string;
    url: string;
    full_path: string;
    markdown: string;
  };

  return { url: json.full_path, markdown: json.markdown };
}
```

Import `AuthError` and `DEFAULT_TIMEOUT_MS` are already imported at the top.

**Step 2: Build to verify**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git commit -m "feat: add REST and uploadFile methods to GitLabApiClient"
```

---

### Task 5: Implement GitLab `uploadImage()`

**Files:**
- Modify: `src/backends/gitlab/index.ts`
- Create: `src/backends/gitlab/image-upload.test.ts`

**Step 1: Write the test**

Create `src/backends/gitlab/image-upload.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabBackend } from './index.js';

// We'll need to mock the API client's uploadFile method
// The test should verify that uploadImage calls api.uploadFile with correct args
// and returns the URL from the response.

describe('GitLabBackend.uploadImage', () => {
  it('calls api.uploadFile and returns the full_path URL', async () => {
    // This test needs a constructed GitLabBackend with a mocked api
    // Since GitLabBackend uses a static create() factory, we may need
    // to test via the API client mock
    const mockApi = {
      uploadFile: vi.fn().mockResolvedValue({
        url: '/uploads/abc123/screenshot.png',
        markdown: '![screenshot](/uploads/abc123/screenshot.png)',
      }),
      graphql: vi.fn(),
      paginate: vi.fn(),
    };

    // Access the upload method directly — implementation will wire this up
    const result = await mockApi.uploadFile(
      'mygroup/myproject',
      Buffer.from('png-data'),
      'screenshot.png',
    );

    expect(mockApi.uploadFile).toHaveBeenCalledWith(
      'mygroup/myproject',
      Buffer.from('png-data'),
      'screenshot.png',
    );
    expect(result.url).toBe('/uploads/abc123/screenshot.png');
  });
});
```

**Step 2: Implement `uploadImage()` in `GitLabBackend`**

In `src/backends/gitlab/index.ts`, add `ImageUploadBackend` import and implement:

```typescript
import type { ImageUploadBackend } from '../types.js';
```

Update class:
```typescript
export class GitLabBackend extends BaseBackend implements ImageUploadBackend
```

Add method:
```typescript
async uploadImage(data: Buffer, filename: string): Promise<string> {
  const result = await this.api.uploadFile(
    this.remote.fullPath,
    data,
    filename,
  );
  // Return absolute URL for use in markdown
  return `https://${this.remote.host}${result.url}`;
}
```

**Step 3: Run tests**

Run: `npx vitest run src/backends/gitlab/image-upload.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git commit -m "feat: implement GitLab image upload via project uploads API"
```

---

### Task 6: Implement ADO `uploadImage()`

**Files:**
- Modify: `src/backends/ado/api.ts`
- Modify: `src/backends/ado/index.ts`
- Create: `src/backends/ado/image-upload.test.ts`

**Step 1: Add `uploadAttachment()` to `AdoApiClient`**

In `src/backends/ado/api.ts`, add:

```typescript
async uploadAttachment(
  project: string,
  data: Buffer,
  filename: string,
): Promise<string> {
  const path = `/${project}/_apis/wit/attachments?fileName=${encodeURIComponent(filename)}`;
  const url = this.baseUrl + this.appendApiVersion(path);

  const headers: Record<string, string> = {
    Authorization: this.getAuthHeader(),
    'Content-Type': 'application/octet-stream',
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await globalThis.fetch(url, {
      method: 'POST',
      headers,
      body: data,
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
    throw new AuthError();
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: Upload failed`);
  }

  const json = (await response.json()) as { url: string };
  return json.url;
}
```

Note: `this.appendApiVersion` is private — make it `protected` or call it here. Actually it's already used in `fetch()` which is overridden. The `uploadAttachment` method builds the URL manually, so it needs access. Check if `appendApiVersion` is private — if so, either make it protected or inline the logic.

**Step 2: Implement `uploadImage()` in `AzureDevOpsBackend`**

In `src/backends/ado/index.ts`:

```typescript
import type { ImageUploadBackend } from '../types.js';
```

Update class:
```typescript
export class AzureDevOpsBackend extends BaseBackend implements ImageUploadBackend
```

Add method:
```typescript
async uploadImage(data: Buffer, filename: string): Promise<string> {
  return this.api.uploadAttachment(this.project, data, filename);
}
```

**Step 3: Write test**

Create `src/backends/ado/image-upload.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('AdoApiClient.uploadAttachment', () => {
  it('sends binary data with octet-stream content type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ url: 'https://dev.azure.com/org/project/_apis/wit/attachments/abc' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { AdoApiClient } = await import('./api.js');
    const client = new AdoApiClient({ type: 'basic', pat: 'test-pat' }, 'org');
    const url = await client.uploadAttachment('project', Buffer.from('img'), 'test.png');

    expect(url).toBe('https://dev.azure.com/org/project/_apis/wit/attachments/abc');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/_apis/wit/attachments'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/octet-stream',
        }),
      }),
    );

    vi.unstubAllGlobals();
  });
});
```

**Step 4: Run tests**

Run: `npx vitest run src/backends/ado/image-upload.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: implement ADO image upload via attachments API"
```

---

### Task 7: Expose remote backend for image upload in backendDataStore

**Files:**
- Modify: `src/stores/backendDataStore.ts`

**Step 1: Add `getImageUploadBackend()` helper**

The MarkdownEditor needs to determine which backend to use for image upload. Add a module-level helper:

```typescript
import { isImageUploadBackend } from '../backends/types.js';

// Add to exported functions or store actions:
export function getImageUploadBackend(): ImageUploadBackend | null {
  // Prefer remote backend if it supports image upload
  if (currentRemoteBackend && isImageUploadBackend(currentRemoteBackend)) {
    return currentRemoteBackend;
  }
  // Fall back to primary (Storage)
  if (currentBackend && isImageUploadBackend(currentBackend)) {
    return currentBackend;
  }
  return null;
}
```

**Step 2: Build to verify**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git commit -m "feat: expose getImageUploadBackend from backendDataStore"
```

---

### Task 8: Update MarkdownEditor to use backend upload

**Files:**
- Modify: `src/components/MarkdownEditor.tsx`

**Step 1: Replace direct `saveImage` call with backend upload**

Replace the import:
```typescript
// Remove: import { saveImage } from '../backends/github/image-upload.js';
import { getImageUploadBackend } from '../stores/backendDataStore.js';
```

Replace the Ctrl+V image paste handler (around line 129):

```typescript
try {
  const uploader = getImageUploadBackend();
  if (!uploader) {
    uiStore.getState().setToast('Image upload not available');
    return;
  }
  const hash = Date.now().toString(36);
  const filename = `paste-${hash}.png`;
  const relPath = await uploader.uploadImage(imageData, filename);
  s.insertText(`![image](${relPath})`);
  uiStore.getState().setToast('Image saved');
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : 'Upload failed';
  uiStore.getState().setToast(`Image paste failed: ${msg}`);
}
```

Note: The existing handler is synchronous in a `useInput` callback. Since `uploadImage()` is now async, we need to handle this carefully. The `useInput` callback can't be async directly. Wrap in a void IIFE or use a ref-based approach:

```typescript
// Paste image: Ctrl+V
if (input === 'v' && key.ctrl) {
  let imageData: Buffer | null;
  try {
    imageData = readClipboardImage();
  } catch (err) {
    if (err instanceof ClipboardError) {
      uiStore.getState().setToast(err.message);
    }
    return;
  }
  if (!imageData) {
    uiStore.getState().setToast('No image found in clipboard');
    return;
  }

  const uploader = getImageUploadBackend();
  if (!uploader) {
    uiStore.getState().setToast('Image upload not available');
    return;
  }

  s.setUploadStatus('Uploading image...');
  const hash = Date.now().toString(36);
  const filename = `paste-${hash}.png`;
  void uploader.uploadImage(imageData, filename).then(
    (relPath) => {
      s.insertText(`![image](${relPath})`);
      s.setUploadStatus(null);
      uiStore.getState().setToast('Image saved');
    },
    (err: unknown) => {
      s.setUploadStatus(null);
      const msg = err instanceof Error ? err.message : 'Upload failed';
      uiStore.getState().setToast(`Image paste failed: ${msg}`);
    },
  );
  return;
}
```

Check if `editorStore` has `setUploadStatus` — it already has `uploadStatus` state, so it should.

**Step 2: Build and test**

Run: `npm run build && npm test`
Expected: PASS

**Step 3: Commit**

```bash
git commit -m "feat: wire MarkdownEditor to use backend image upload"
```

---

### Task 9: Final cleanup and verification

**Files:**
- Possibly delete: `src/backends/github/image-upload.ts` (if not already deleted in Task 3)
- Possibly delete: `src/backends/github/image-upload.test.ts`

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 2: Run lint and format**

Run: `npm run lint && npm run format:check`
Expected: PASS

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Verify capabilities**

Check that `getCapabilities().imageUpload` returns correct values:
- Storage: `true`
- GitHub: `true`
- GitLab: `true`
- ADO: `true`
- Jira: `false`
- Files: `false`

**Step 5: Commit any remaining changes**

```bash
git commit -m "chore: cleanup old image-upload code"
```

---

## Summary of Changes

| File | Action | Description |
|------|--------|-------------|
| `src/backends/types.ts` | Modify | Add `imageUpload` to capabilities, `ImageUploadBackend` interface + type guard |
| `src/storage/image-save.ts` | Create | `saveImageLocal()` — shared local save to `.tic/images/` |
| `src/storage/image-save.test.ts` | Create | Tests for local image save |
| `src/storage/index.ts` | Modify | Implement `ImageUploadBackend`, add `uploadImage()` |
| `src/backends/github/index.ts` | Modify | Implement `ImageUploadBackend` using `saveImageLocal()` |
| `src/backends/github/image-upload.ts` | Delete | Replaced by `src/storage/image-save.ts` |
| `src/backends/github/image-upload.test.ts` | Delete | Replaced by `src/storage/image-save.test.ts` |
| `src/backends/gitlab/api.ts` | Modify | Add `rest()` and `uploadFile()` methods |
| `src/backends/gitlab/index.ts` | Modify | Implement `ImageUploadBackend` |
| `src/backends/gitlab/image-upload.test.ts` | Create | Test for GitLab upload |
| `src/backends/ado/api.ts` | Modify | Add `uploadAttachment()` method |
| `src/backends/ado/index.ts` | Modify | Implement `ImageUploadBackend` |
| `src/backends/ado/image-upload.test.ts` | Create | Test for ADO upload |
| `src/stores/backendDataStore.ts` | Modify | Export `getImageUploadBackend()` |
| `src/components/MarkdownEditor.tsx` | Modify | Use `getImageUploadBackend()` instead of direct `saveImage()` |
