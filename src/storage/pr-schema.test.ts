import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createDatabase } from './db.js';
import { pullRequests, prItemLinks } from './schema.js';

describe('PR schema', () => {
  it('creates pull_requests table', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tic-test-'));
    const db = createDatabase(tmpDir);
    const result = db.select().from(pullRequests).all();
    expect(result).toEqual([]);
  });

  it('creates pr_item_links table', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tic-test-'));
    const db = createDatabase(tmpDir);
    const result = db.select().from(prItemLinks).all();
    expect(result).toEqual([]);
  });
});
