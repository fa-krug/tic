import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { WorkItem, Comment } from '../../types.js';

function itemsDir(root: string): string {
  return path.join(root, '.tic', 'items');
}

function itemPath(root: string, id: string): string {
  return path.join(itemsDir(root), `${id}.md`);
}

export async function listItemFiles(root: string): Promise<string[]> {
  const dir = itemsDir(root);
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function serializeComments(comments: Comment[]): string {
  if (comments.length === 0) return '';
  const parts = comments.map(
    (c) => `---\nauthor: ${c.author}\ndate: ${c.date}\n\n${c.body}`,
  );
  return '\n\n## Comments\n\n' + parts.join('\n\n');
}

function parseComments(content: string): {
  description: string;
  comments: Comment[];
} {
  const marker = '## Comments';
  const idx = content.indexOf(marker);
  if (idx === -1) return { description: content.trim(), comments: [] };

  const description = content.slice(0, idx).trim();
  const commentsRaw = content.slice(idx + marker.length).trim();
  const blocks = commentsRaw.split(/\n---\n/).filter((b) => b.trim());

  const comments: Comment[] = blocks.map((block) => {
    const lines = block.trim().split('\n');
    let author = '';
    let date = '';
    const bodyLines: string[] = [];
    let pastMeta = false;
    for (const line of lines) {
      if (!pastMeta && line === '---') {
        continue;
      }
      if (!pastMeta && line.startsWith('author: ')) {
        author = line.slice('author: '.length).trim();
      } else if (!pastMeta && line.startsWith('date: ')) {
        date = line.slice('date: '.length).trim();
      } else if (!pastMeta && line === '') {
        pastMeta = true;
      } else {
        pastMeta = true;
        bodyLines.push(line);
      }
    }
    return { author, date, body: bodyLines.join('\n').trim() };
  });

  return { description, comments };
}

export async function readWorkItem(
  root: string,
  id: string,
): Promise<WorkItem> {
  const raw = await fs.readFile(itemPath(root, id), 'utf-8');
  return parseWorkItemFile(raw);
}

export function parseWorkItemFile(raw: string): WorkItem {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const { description, comments } = parseComments(parsed.content);

  return {
    id: String(data['id']),
    title: data['title'] as string,
    type: (data['type'] as string) || 'issue',
    status: data['status'] as string,
    iteration: data['iteration'] as string,
    priority: data['priority'] as WorkItem['priority'],
    assignee: (data['assignee'] as string) || '',
    labels: (data['labels'] as string[]) || [],
    created: data['created'] as string,
    updated: data['updated'] as string,
    parent:
      data['parent'] != null ? String(data['parent'] as string | number) : null,
    dependsOn: Array.isArray(data['depends_on'])
      ? (data['depends_on'] as unknown[]).map(String)
      : [],
    description,
    comments,
  };
}

export async function writeWorkItem(
  root: string,
  item: WorkItem,
): Promise<void> {
  const dir = itemsDir(root);
  await fs.mkdir(dir, { recursive: true });

  const frontmatter: Record<string, unknown> = {
    id: item.id,
    title: item.title,
    type: item.type,
    status: item.status,
    iteration: item.iteration,
    priority: item.priority,
    assignee: item.assignee,
    labels: item.labels,
    created: item.created,
    updated: item.updated,
  };

  if (item.parent !== null) {
    frontmatter['parent'] = item.parent;
  }

  if (item.dependsOn.length > 0) {
    frontmatter['depends_on'] = item.dependsOn;
  }

  const body = item.description + serializeComments(item.comments);
  const content = matter.stringify(body, frontmatter);
  await fs.writeFile(itemPath(root, item.id), content);
}

export async function deleteWorkItem(root: string, id: string): Promise<void> {
  try {
    await fs.unlink(itemPath(root, id));
  } catch {
    // File doesn't exist — nothing to delete
  }
}
