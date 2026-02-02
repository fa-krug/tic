import type { WorkItem } from '../types.js';

export interface FuzzyResult {
  item: WorkItem;
  score: number;
}

function scoreField(field: string, query: string): number {
  const lower = field.toLowerCase();
  const q = query.toLowerCase();

  if (lower === q) return 100; // exact match
  if (lower.startsWith(q)) return 80; // prefix match

  // Word-boundary match (query appears at start of a word)
  const words = lower.split(/[\s\-_]+/);
  for (const word of words) {
    if (word.startsWith(q)) return 60;
  }

  // Substring match
  if (lower.includes(q)) return 40;

  return 0;
}

export function fuzzyMatch(items: WorkItem[], query: string): FuzzyResult[] {
  if (query.trim() === '') return [];

  const q = query.trim().toLowerCase();
  const results: FuzzyResult[] = [];

  for (const item of items) {
    const titleScore = scoreField(item.title, q);
    const idScore = scoreField(item.id, q);
    const labelScore = Math.max(0, ...item.labels.map((l) => scoreField(l, q)));
    const bestScore = Math.max(titleScore, idScore, labelScore);

    if (bestScore > 0) {
      results.push({ item, score: bestScore });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
