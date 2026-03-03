import { describe, it, expect } from 'vitest';
import type { Iteration } from './types.js';
import {
  findCurrentIteration,
  formatIterationDates,
  getIterationStatus,
} from './iteration-utils.js';

describe('findCurrentIteration', () => {
  it('returns iteration whose date range contains today', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const iterations: Iteration[] = [
      { name: 'past', startDate: '2020-01-01', endDate: '2020-01-31' },
      {
        name: 'current',
        startDate: yesterday.toISOString().split('T')[0]!,
        endDate: tomorrow.toISOString().split('T')[0]!,
      },
      { name: 'future', startDate: '2099-01-01', endDate: '2099-01-31' },
    ];

    expect(findCurrentIteration(iterations)).toBe('current');
  });

  it('returns null when no iteration matches today', () => {
    const iterations: Iteration[] = [
      { name: 'past', startDate: '2020-01-01', endDate: '2020-01-31' },
    ];
    expect(findCurrentIteration(iterations)).toBeNull();
  });

  it('returns null for iterations with no dates', () => {
    const iterations: Iteration[] = [
      { name: 'no-dates', startDate: null, endDate: null },
    ];
    expect(findCurrentIteration(iterations)).toBeNull();
  });
});

describe('formatIterationDates', () => {
  it('formats both dates as short range', () => {
    expect(formatIterationDates('2026-01-06', '2026-01-20')).toBe(
      'Jan 6 \u2013 Jan 20',
    );
  });

  it('formats end date only as due date', () => {
    expect(formatIterationDates(null, '2026-01-20')).toBe('due Jan 20');
  });

  it('formats start date only', () => {
    expect(formatIterationDates('2026-01-06', null)).toBe('from Jan 6');
  });

  it('returns null when no dates', () => {
    expect(formatIterationDates(null, null)).toBeNull();
  });
});

describe('getIterationStatus', () => {
  it('returns active when today is in range', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    expect(
      getIterationStatus(
        yesterday.toISOString().split('T')[0]!,
        tomorrow.toISOString().split('T')[0]!,
      ),
    ).toBe('active');
  });

  it('returns past when end date has passed', () => {
    expect(getIterationStatus('2020-01-01', '2020-01-31')).toBe('past');
  });

  it('returns upcoming when start date is future', () => {
    expect(getIterationStatus('2099-01-01', '2099-01-31')).toBe('upcoming');
  });

  it('returns null when no dates', () => {
    expect(getIterationStatus(null, null)).toBeNull();
  });
});
