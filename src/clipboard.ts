import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export class ClipboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipboardError';
  }
}

// JXA script that reads image from macOS clipboard and writes PNG to a temp file.
// Handles both PNG and TIFF clipboard data (screenshots are often TIFF).
function darwinJxa(tmpPath: string): string {
  return `
ObjC.import('AppKit');
ObjC.import('Foundation');
var pb = $.NSPasteboard.generalPasteboard;
var imgData = pb.dataForType($.NSPasteboardTypePNG);
if (imgData.isNil()) {
  var tiffData = pb.dataForType($.NSPasteboardTypeTIFF);
  if (tiffData.isNil()) {
    // No image data on clipboard
    $.exit(1);
  }
  var rep = $.NSBitmapImageRep.imageRepWithData(tiffData);
  imgData = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
}
imgData.writeToFileAtomically(${JSON.stringify(tmpPath)}, true);
`;
}

export function readClipboardImage(): Buffer | null {
  if (process.platform === 'darwin') {
    const tmp = join(
      tmpdir(),
      'tic-clip-' + randomBytes(4).toString('hex') + '.png',
    );
    try {
      execFileSync('osascript', ['-l', 'JavaScript', '-e', darwinJxa(tmp)], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const data = readFileSync(tmp);
      return data;
    } catch {
      return null;
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  if (process.platform === 'linux') {
    try {
      execFileSync('which', ['xclip'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      throw new ClipboardError('xclip is required: sudo apt install xclip');
    }
    try {
      const data = execFileSync(
        'xclip',
        ['-selection', 'clipboard', '-t', 'image/png', '-o'],
        { maxBuffer: 50 * 1024 * 1024 },
      );
      return Buffer.from(data);
    } catch {
      return null;
    }
  }

  return null;
}
