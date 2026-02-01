import { describe, it, expect } from 'vitest';
import { formatPriority, formatAssignee } from './CardLayout.js';

describe('CardLayout helpers', () => {
  describe('formatPriority', () => {
    it('returns arrow prefix for known priorities', () => {
      expect(formatPriority('high')).toBe('↑High');
      expect(formatPriority('High')).toBe('↑High');
      expect(formatPriority('medium')).toBe('→Med');
      expect(formatPriority('Medium')).toBe('→Med');
      expect(formatPriority('low')).toBe('↓Low');
      expect(formatPriority('Low')).toBe('↓Low');
    });

    it('returns empty string for empty/undefined priority', () => {
      expect(formatPriority('')).toBe('');
      expect(formatPriority(undefined)).toBe('');
    });

    it('returns raw value for unknown priorities', () => {
      expect(formatPriority('critical')).toBe('critical');
    });
  });

  describe('formatAssignee', () => {
    it('prefixes with @ if not already present', () => {
      expect(formatAssignee('alex')).toBe('@alex');
    });

    it('does not double-prefix', () => {
      expect(formatAssignee('@alex')).toBe('@alex');
    });

    it('returns empty string for empty/undefined', () => {
      expect(formatAssignee('')).toBe('');
      expect(formatAssignee(undefined)).toBe('');
    });
  });
});
