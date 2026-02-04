import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  slugifyTemplateName,
  readTemplate,
  writeTemplate,
  deleteTemplate,
  listTemplates,
} from './templates.js';
import type { Template } from '../../types.js';

describe('slugifyTemplateName', () => {
  it('converts name to kebab-case slug', () => {
    expect(slugifyTemplateName('Bug Report')).toBe('bug-report');
  });

  it('handles special characters', () => {
    expect(slugifyTemplateName('Feature: Add Login')).toBe('feature-add-login');
  });

  it('handles multiple spaces and hyphens', () => {
    expect(slugifyTemplateName('My  Template--Name')).toBe('my-template-name');
  });

  it('trims trailing hyphens', () => {
    expect(slugifyTemplateName('Test-')).toBe('test');
  });

  it('trims leading hyphens', () => {
    expect(slugifyTemplateName('--Test')).toBe('test');
  });

  it('handles empty string', () => {
    expect(slugifyTemplateName('')).toBe('');
  });
});

describe('template I/O', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tic-tmpl-'));
    await fs.mkdir(path.join(tmpDir, '.tic', 'templates'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads a template', async () => {
    const template: Template = {
      slug: 'bug-report',
      name: 'Bug Report',
      type: 'bug',
      priority: 'high',
      labels: ['bug', 'needs-triage'],
      description: '## Steps to Reproduce\n\n1.\n\n## Expected Behavior\n',
    };
    await writeTemplate(tmpDir, template);
    const read = await readTemplate(tmpDir, 'bug-report');
    expect(read.slug).toBe('bug-report');
    expect(read.name).toBe('Bug Report');
    expect(read.type).toBe('bug');
    expect(read.priority).toBe('high');
    expect(read.labels).toEqual(['bug', 'needs-triage']);
    expect(read.description).toContain('Steps to Reproduce');
  });

  it('writes a minimal template (name only)', async () => {
    const template: Template = {
      slug: 'blank',
      name: 'Blank',
    };
    await writeTemplate(tmpDir, template);
    const read = await readTemplate(tmpDir, 'blank');
    expect(read.slug).toBe('blank');
    expect(read.name).toBe('Blank');
    expect(read.type).toBeUndefined();
    expect(read.description).toBe('');
  });

  it('lists templates', async () => {
    await writeTemplate(tmpDir, { slug: 'a-template', name: 'A Template' });
    await writeTemplate(tmpDir, { slug: 'b-template', name: 'B Template' });
    const templates = await listTemplates(tmpDir);
    expect(templates).toHaveLength(2);
    const names = templates.map((t) => t.name).sort();
    expect(names).toEqual(['A Template', 'B Template']);
  });

  it('returns empty list when no templates dir', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tic-empty-'));
    const templates = await listTemplates(emptyDir);
    expect(templates).toEqual([]);
    await fs.rm(emptyDir, { recursive: true, force: true });
  });

  it('deletes a template', async () => {
    await writeTemplate(tmpDir, { slug: 'to-delete', name: 'To Delete' });
    await deleteTemplate(tmpDir, 'to-delete');
    const templates = await listTemplates(tmpDir);
    expect(templates).toEqual([]);
  });
});
