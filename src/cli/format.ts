export function formatTsvRow(fields: string[]): string {
  return fields.join('\t');
}

export function formatTsvKeyValue(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => `${k}\t${v}`).join('\n');
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
