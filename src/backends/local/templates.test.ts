import { describe, it, expect } from 'vitest';
import { slugifyTemplateName } from './templates.js';

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

  it('handles empty string', () => {
    expect(slugifyTemplateName('')).toBe('');
  });
});
