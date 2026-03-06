# Image Paste in Markdown Editor with GitHub Upload

## Overview

Add the ability to paste images from the clipboard into the built-in markdown editor. When an image is pasted, upload it to the GitHub repo and insert a markdown image link at the cursor position.

## Flow

1. User presses `Ctrl+V` in the markdown editor
2. Check if GitHub backend is configured — if not, fall through to normal input
3. Read clipboard for image data via platform tools (`pbpaste` on macOS, `xclip` on Linux)
4. If no image data on clipboard, fall through to normal character input
5. Show "Uploading image..." in the editor status bar
6. Compute SHA-256 hash of image content (first 12 hex chars) for filename
7. Upload to GitHub via Git Data API:
   - Create blob (base64-encoded image)
   - Get current tree SHA of default branch HEAD
   - Create tree adding `.github/tic-images/{hash}.png`
   - Create commit referencing the new tree
   - Update branch ref
8. Construct raw URL: `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/.github/tic-images/{hash}.png`
9. Insert `![image](url)` at cursor position
10. Clear status indicator

## Image Storage

- Path: `.github/tic-images/` in the repo
- Naming: SHA-256 content hash (first 12 hex chars) + extension
- Deduplicates identical images automatically

## Error Handling

- **No GitHub backend configured:** silently ignore, normal input passthrough
- **No image on clipboard:** fall through to normal text input
- **Upload failure:** error toast in UI

## New Files

- `src/clipboard.ts` — `readClipboardImage(): Buffer | null` — platform-specific clipboard image reading
- `src/backends/github/image-upload.ts` — `uploadImage(api, owner, repo, branch, imageData): Promise<string>` — Git Data API upload, returns raw URL

## Modified Files

- `src/stores/editorStore.ts` — add `uploadStatus: string | null` state, `pasteImage()` async action
- `src/components/MarkdownEditor.tsx` — handle `Ctrl+V`, show upload status in status bar
- `src/backends/github/api.ts` — may need a method for raw binary blob creation

## Keybinding

`Ctrl+V` in the editor's `useInput` handler. Ink receives this as `input === 'v' && key.ctrl`. On detection, run the async image paste flow before falling through to character insertion.

## Scope

- GitHub-only (gated on GitHub backend being configured)
- macOS and Linux clipboard support
