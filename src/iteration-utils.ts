import type { Iteration } from './types.js';

export function findCurrentIteration(iterations: Iteration[]): string | null {
  const today = new Date().toISOString().split('T')[0]!;
  for (const it of iterations) {
    if (
      it.startDate &&
      it.endDate &&
      it.startDate <= today &&
      today <= it.endDate
    ) {
      return it.name;
    }
  }
  return null;
}

export function formatIterationDates(
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (!startDate && !endDate) return null;

  const fmt = (iso: string): string => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const date = new Date(y, m - 1, d);
    const month = date.toLocaleString('en-US', { month: 'short' });
    return `${month} ${date.getDate()}`;
  };

  if (startDate && endDate) return `${fmt(startDate)} \u2013 ${fmt(endDate)}`;
  if (endDate) return `due ${fmt(endDate)}`;
  return `from ${fmt(startDate!)}`;
}

export function getIterationStatus(
  startDate: string | null,
  endDate: string | null,
): 'active' | 'past' | 'upcoming' | null {
  if (!startDate && !endDate) return null;
  const today = new Date().toISOString().split('T')[0]!;
  if (endDate && endDate < today) return 'past';
  if (startDate && startDate > today) return 'upcoming';
  return 'active';
}
