import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import type { Template } from '../../types.js';

function templatesDir(root: string): string {
  return path.join(root, '.tic', 'templates');
}

function templatePath(root: string, slug: string): string {
  return path.join(templatesDir(root), `${slug}.md`);
}

export function slugifyTemplateName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseTemplateFile(raw: string, slug: string): Template {
  const parsed = parseFrontmatter(raw);
  const data = parsed.data;
  const description = parsed.content.trim();

  const template: Template = {
    slug,
    name: (data['name'] as string) || slug,
  };

  if (data['type'] != null) template.type = data['type'] as string;
  if (data['status'] != null) template.status = data['status'] as string;
  if (data['priority'] != null)
    template.priority = data['priority'] as Template['priority'];
  if (data['assignee'] != null) template.assignee = data['assignee'] as string;
  if (Array.isArray(data['labels']))
    template.labels = data['labels'] as string[];
  if (data['iteration'] != null)
    template.iteration = data['iteration'] as string;
  if (data['parent'] != null)
    template.parent = String(data['parent'] as string | number);
  if (Array.isArray(data['depends_on']))
    template.dependsOn = (data['depends_on'] as unknown[]).map(String);

  template.description = description;

  return template;
}

export async function readTemplate(
  root: string,
  slug: string,
): Promise<Template> {
  const raw = await fs.readFile(templatePath(root, slug), 'utf-8');
  return parseTemplateFile(raw, slug);
}

export async function writeTemplate(
  root: string,
  template: Template,
): Promise<void> {
  const dir = templatesDir(root);
  await fs.mkdir(dir, { recursive: true });

  const frontmatter: Record<string, unknown> = {
    name: template.name,
  };

  if (template.type != null) frontmatter['type'] = template.type;
  if (template.status != null) frontmatter['status'] = template.status;
  if (template.priority != null) frontmatter['priority'] = template.priority;
  if (template.assignee != null) frontmatter['assignee'] = template.assignee;
  if (template.labels != null && template.labels.length > 0)
    frontmatter['labels'] = template.labels;
  if (template.iteration != null) frontmatter['iteration'] = template.iteration;
  if (template.parent != null) frontmatter['parent'] = template.parent;
  if (template.dependsOn != null && template.dependsOn.length > 0)
    frontmatter['depends_on'] = template.dependsOn;

  const body = template.description ?? '';
  const content = stringifyFrontmatter(body, frontmatter);
  await fs.writeFile(templatePath(root, template.slug), content);
}

export async function deleteTemplate(
  root: string,
  slug: string,
): Promise<void> {
  try {
    await fs.unlink(templatePath(root, slug));
  } catch {
    // File doesn't exist — nothing to delete
  }
}

export async function listTemplates(root: string): Promise<Template[]> {
  const dir = templatesDir(root);
  try {
    const entries = await fs.readdir(dir);
    const files = entries.filter((f) => f.endsWith('.md'));
    const templates: Template[] = [];
    for (const file of files) {
      const slug = file.replace(/\.md$/, '');
      const raw = await fs.readFile(path.join(dir, file), 'utf-8');
      templates.push(parseTemplateFile(raw, slug));
    }
    return templates;
  } catch {
    return [];
  }
}
