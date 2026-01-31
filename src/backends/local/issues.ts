import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import type { Issue, Comment } from '../../types.js';

function issuesDir(root: string): string {
  return path.join(root, '.tic', 'issues');
}

function issuePath(root: string, id: number): string {
  return path.join(issuesDir(root), `${id}.md`);
}

export function listIssueFiles(root: string): string[] {
  const dir = issuesDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f));
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
      // Skip leading --- delimiter line (present on first block)
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

export function readIssue(root: string, id: number): Issue {
  const raw = fs.readFileSync(issuePath(root, id), 'utf-8');
  return parseIssueFile(raw);
}

export function parseIssueFile(raw: string): Issue {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const { description, comments } = parseComments(parsed.content);

  return {
    id: data['id'] as number,
    title: data['title'] as string,
    status: data['status'] as string,
    iteration: data['iteration'] as string,
    priority: data['priority'] as Issue['priority'],
    assignee: (data['assignee'] as string) || '',
    labels: (data['labels'] as string[]) || [],
    created: data['created'] as string,
    updated: data['updated'] as string,
    description,
    comments,
  };
}

export function writeIssue(root: string, issue: Issue): void {
  const dir = issuesDir(root);
  fs.mkdirSync(dir, { recursive: true });

  const frontmatter = {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    iteration: issue.iteration,
    priority: issue.priority,
    assignee: issue.assignee,
    labels: issue.labels,
    created: issue.created,
    updated: issue.updated,
  };

  const body = issue.description + serializeComments(issue.comments);
  const content = matter.stringify(body, frontmatter);
  fs.writeFileSync(issuePath(root, issue.id), content);
}

export function deleteIssue(root: string, id: number): void {
  const p = issuePath(root, id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
