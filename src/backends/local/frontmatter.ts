import yaml from 'yaml';

export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  const data = (yaml.parse(match[1]!) as Record<string, unknown>) ?? {};
  return { data, content: match[2]! };
}

export function stringifyFrontmatter(
  content: string,
  data: Record<string, unknown>,
): string {
  const yamlStr = yaml.stringify(data).trimEnd();
  return `---\n${yamlStr}\n---\n${content}\n`;
}
