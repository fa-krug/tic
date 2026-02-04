# Issue Templates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add issue templates that pre-fill work item fields on create, with template management in Settings and GitLab sync.

**Architecture:** Templates are stored as markdown files with YAML frontmatter in `.tic/templates/{slug}.md`, following the same pattern as work items. A `Template` type with a `name` field (instead of `title`) and optional prefill fields. Backend capabilities are extended with `templateFields` to control which fields templates can set per-backend. The TUI shows a TemplatePicker overlay when creating items (if templates exist), and Settings gets a template management section using the existing WorkItemForm in a `template` mode.

**Tech Stack:** TypeScript, React 19/Ink 6, gray-matter, vitest

---

### Task 1: Add Template Type and Slugify Utility

**Files:**
- Modify: `src/types.ts:1-41`
- Create: `src/backends/local/templates.ts`
- Test: `src/backends/local/templates.test.ts`

**Step 1: Write the failing test for Template type and slugifyTemplateName**

```typescript
// src/backends/local/templates.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/local/templates.test.ts`
Expected: FAIL — module not found

**Step 3: Add Template type to types.ts**

Add at the end of `src/types.ts` (after line 41):

```typescript
export interface Template {
  slug: string;
  name: string;
  type?: string;
  status?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  labels?: string[];
  iteration?: string;
  parent?: string | null;
  dependsOn?: string[];
  description?: string;
}
```

**Step 4: Write the slugify function and template I/O stubs**

Create `src/backends/local/templates.ts`:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
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
    .replace(/-+$/, '');
}
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/backends/local/templates.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/types.ts src/backends/local/templates.ts src/backends/local/templates.test.ts
git commit -m "feat: add Template type and slugifyTemplateName utility"
```

---

### Task 2: Implement Template Read/Write/Delete/List

**Files:**
- Modify: `src/backends/local/templates.ts`
- Test: `src/backends/local/templates.test.ts`

**Step 1: Write failing tests for template I/O**

Add to `src/backends/local/templates.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  slugifyTemplateName,
  readTemplate,
  writeTemplate,
  deleteTemplate,
  listTemplates,
} from './templates.js';
import type { Template } from '../../types.js';

describe('template I/O', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tic-tmpl-'));
    await fs.mkdir(path.join(tmpDir, '.tic', 'templates'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads a template', async () => {
    const template: Template = {
      slug: 'bug-report',
      name: 'Bug Report',
      type: 'bug',
      priority: 'high',
      labels: ['bug', 'needs-triage'],
      description: '## Steps to Reproduce\n\n1.\n\n## Expected Behavior\n',
    };
    await writeTemplate(tmpDir, template);
    const read = await readTemplate(tmpDir, 'bug-report');
    expect(read.slug).toBe('bug-report');
    expect(read.name).toBe('Bug Report');
    expect(read.type).toBe('bug');
    expect(read.priority).toBe('high');
    expect(read.labels).toEqual(['bug', 'needs-triage']);
    expect(read.description).toContain('Steps to Reproduce');
  });

  it('writes a minimal template (name only)', async () => {
    const template: Template = {
      slug: 'blank',
      name: 'Blank',
    };
    await writeTemplate(tmpDir, template);
    const read = await readTemplate(tmpDir, 'blank');
    expect(read.slug).toBe('blank');
    expect(read.name).toBe('Blank');
    expect(read.type).toBeUndefined();
    expect(read.description).toBe('');
  });

  it('lists templates', async () => {
    await writeTemplate(tmpDir, { slug: 'a-template', name: 'A Template' });
    await writeTemplate(tmpDir, { slug: 'b-template', name: 'B Template' });
    const templates = await listTemplates(tmpDir);
    expect(templates).toHaveLength(2);
    const names = templates.map((t) => t.name).sort();
    expect(names).toEqual(['A Template', 'B Template']);
  });

  it('returns empty list when no templates dir', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tic-empty-'));
    const templates = await listTemplates(emptyDir);
    expect(templates).toEqual([]);
    await fs.rm(emptyDir, { recursive: true, force: true });
  });

  it('deletes a template', async () => {
    await writeTemplate(tmpDir, { slug: 'to-delete', name: 'To Delete' });
    await deleteTemplate(tmpDir, 'to-delete');
    const templates = await listTemplates(tmpDir);
    expect(templates).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/local/templates.test.ts`
Expected: FAIL — functions not exported

**Step 3: Implement template I/O functions**

Add to `src/backends/local/templates.ts`:

```typescript
export function parseTemplateFile(raw: string, slug: string): Template {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
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
  if (Array.isArray(data['labels'])) template.labels = data['labels'] as string[];
  if (data['iteration'] != null)
    template.iteration = data['iteration'] as string;
  if (data['parent'] != null)
    template.parent = String(data['parent'] as string | number);
  if (Array.isArray(data['depends_on']))
    template.dependsOn = (data['depends_on'] as unknown[]).map(String);

  if (description) template.description = description;

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
  if (template.iteration != null)
    frontmatter['iteration'] = template.iteration;
  if (template.parent != null) frontmatter['parent'] = template.parent;
  if (template.dependsOn != null && template.dependsOn.length > 0)
    frontmatter['depends_on'] = template.dependsOn;

  const body = template.description ?? '';
  const content = matter.stringify(body, frontmatter);
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/local/templates.test.ts`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add src/backends/local/templates.ts src/backends/local/templates.test.ts
git commit -m "feat: implement template read/write/delete/list with frontmatter I/O"
```

---

### Task 3: Add templateFields to BackendCapabilities and Backend Interface

**Files:**
- Modify: `src/backends/types.ts:4-17` (BackendCapabilities), `src/backends/types.ts:26-48` (Backend interface)
- Modify: `src/backends/local/index.ts` (LocalBackend.getCapabilities)
- Modify: `src/backends/gitlab/index.ts` (GitLabBackend.getCapabilities)
- Modify: `src/backends/github/index.ts` (GitHubBackend.getCapabilities)
- Modify: `src/backends/ado/index.ts` (AzureDevOpsBackend.getCapabilities)
- Modify: `src/backends/jira/index.ts` (JiraBackend.getCapabilities)

**Step 1: Add templateFields to BackendCapabilities**

In `src/backends/types.ts`, add to `BackendCapabilities` interface (after line 16, before closing `}`):

```typescript
  templates: boolean;
  templateFields: {
    type: boolean;
    status: boolean;
    priority: boolean;
    assignee: boolean;
    labels: boolean;
    iteration: boolean;
    parent: boolean;
    dependsOn: boolean;
    description: boolean;
  };
```

**Step 2: Add template methods to Backend interface**

In `src/backends/types.ts`, add to `Backend` interface (after `openItem` on line 47):

```typescript
  listTemplates(): Promise<Template[]>;
  getTemplate(slug: string): Promise<Template>;
  createTemplate(template: Template): Promise<Template>;
  updateTemplate(oldSlug: string, template: Template): Promise<Template>;
  deleteTemplate(slug: string): Promise<void>;
```

Add `Template` to the import at line 1:

```typescript
import type { WorkItem, NewWorkItem, NewComment, Comment, Template } from '../types.js';
```

**Step 3: Add abstract methods to BaseBackend**

In `src/backends/types.ts`, add to `BaseBackend` class (after line 78):

```typescript
  abstract listTemplates(): Promise<Template[]>;
  abstract getTemplate(slug: string): Promise<Template>;
  abstract createTemplate(template: Template): Promise<Template>;
  abstract updateTemplate(oldSlug: string, template: Template): Promise<Template>;
  abstract deleteTemplate(slug: string): Promise<void>;
```

**Step 4: Implement template methods in LocalBackend**

In `src/backends/local/index.ts`, add import:

```typescript
import {
  listTemplates as listTemplateFiles,
  readTemplate,
  writeTemplate,
  deleteTemplate as removeTemplateFile,
  slugifyTemplateName,
} from './templates.js';
```

Add to `getCapabilities()` return value:

```typescript
  templates: true,
  templateFields: {
    type: true,
    status: true,
    priority: true,
    assignee: true,
    labels: true,
    iteration: true,
    parent: true,
    dependsOn: true,
    description: true,
  },
```

Add template methods to LocalBackend:

```typescript
  async listTemplates(): Promise<Template[]> {
    return listTemplateFiles(this.root);
  }

  async getTemplate(slug: string): Promise<Template> {
    return readTemplate(this.root, slug);
  }

  async createTemplate(template: Template): Promise<Template> {
    const slug = slugifyTemplateName(template.name);
    const t = { ...template, slug };
    await writeTemplate(this.root, t);
    return t;
  }

  async updateTemplate(oldSlug: string, template: Template): Promise<Template> {
    const newSlug = slugifyTemplateName(template.name);
    if (oldSlug !== newSlug) {
      await removeTemplateFile(this.root, oldSlug);
    }
    const t = { ...template, slug: newSlug };
    await writeTemplate(this.root, t);
    return t;
  }

  async deleteTemplate(slug: string): Promise<void> {
    await removeTemplateFile(this.root, slug);
  }
```

**Step 5: Add stub implementations in GitLab, GitHub, ADO, Jira backends**

Each backend gets `templates: false` and all `templateFields` set to `false` in `getCapabilities()`, plus stub template methods that throw `UnsupportedOperationError`. GitLab is special:

For **GitLabBackend** (`src/backends/gitlab/index.ts`):
```typescript
  // In getCapabilities():
  templates: true,
  templateFields: {
    type: false,
    status: false,
    priority: false,
    assignee: false,
    labels: false,
    iteration: false,
    parent: false,
    dependsOn: false,
    description: true,
  },
```

GitLab template methods delegate to local storage for now (sync comes in Task 7).

For **GitHub, ADO, Jira**:
```typescript
  // In getCapabilities():
  templates: false,
  templateFields: {
    type: false,
    status: false,
    priority: false,
    assignee: false,
    labels: false,
    iteration: false,
    parent: false,
    dependsOn: false,
    description: false,
  },
```

Template methods throw `UnsupportedOperationError('templates', backendName)`.

**Step 6: Run build to verify types**

Run: `npm run build`
Expected: PASS — no type errors

**Step 7: Run all tests**

Run: `npm test`
Expected: PASS

**Step 8: Commit**

```bash
git add src/backends/types.ts src/backends/local/index.ts src/backends/gitlab/index.ts src/backends/github/index.ts src/backends/ado/index.ts src/backends/jira/index.ts
git commit -m "feat: add templateFields to BackendCapabilities and template CRUD to Backend interface"
```

---

### Task 4: Create TemplatePicker Overlay Component

**Files:**
- Create: `src/components/TemplatePicker.tsx`

**Step 1: Create TemplatePicker following PriorityPicker pattern**

Reference: `src/components/PriorityPicker.tsx` (the overlay pattern — `onSelect`/`onCancel` props, `useInput` for Escape, `SelectInput` for selection).

Create `src/components/TemplatePicker.tsx`:

```typescript
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import type { Template } from '../types.js';

interface TemplatePickerProps {
  templates: Template[];
  onSelect: (template: Template | null) => void;
  onCancel: () => void;
}

export function TemplatePicker({
  templates,
  onSelect,
  onCancel,
}: TemplatePickerProps) {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const items = [
    { label: 'No template', value: '__none__' },
    ...templates.map((t) => ({ label: t.name, value: t.slug })),
  ];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Select Template</Text>
      </Box>
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (item.value === '__none__') {
            onSelect(null);
          } else {
            const template = templates.find((t) => t.slug === item.value);
            onSelect(template ?? null);
          }
        }}
      />
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Run build to verify types**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/TemplatePicker.tsx
git commit -m "feat: add TemplatePicker overlay component"
```

---

### Task 5: Integrate TemplatePicker into WorkItemList Create Flow

**Files:**
- Modify: `src/app.tsx:21-35` (AppState — add template state)
- Modify: `src/components/WorkItemList.tsx:304-307` (create handler)
- Modify: `src/components/WorkItemForm.tsx:154-167` (initial field values)

**Step 1: Add template state to AppContext**

In `src/app.tsx`, add to `AppState` interface (after line 30, `setActiveType`):

```typescript
  activeTemplate: Template | null;
  setActiveTemplate: (template: Template | null) => void;
```

Add import for Template:

```typescript
import type { Template } from './types.js';
```

In `App` component, add state (after line 54):

```typescript
  const [activeTemplate, setActiveTemplate] = useState<Template | null>(null);
```

Add to `state` object (after line 98, `setActiveType`):

```typescript
  activeTemplate,
  setActiveTemplate,
```

**Step 2: Modify WorkItemList to show TemplatePicker on create**

In `src/components/WorkItemList.tsx`, add imports:

```typescript
import { TemplatePicker } from './TemplatePicker.js';
import type { Template } from '../types.js';
```

Add state variables (after line 72, `showCommandPalette`):

```typescript
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
```

Get `setActiveTemplate` from `useAppState()` (add to destructuring at line 42-50).

Load templates on mount (add effect):

```typescript
  useEffect(() => {
    if (capabilities.templates) {
      void backend.listTemplates().then(setTemplates);
    }
  }, [backend, capabilities.templates]);
```

Modify the `c` key handler (lines 304-307) to check for templates:

```typescript
    if (input === 'c') {
      if (capabilities.templates && templates.length > 0) {
        setShowTemplatePicker(true);
      } else {
        setActiveTemplate(null);
        selectWorkItem(null);
        navigate('form');
      }
    }
```

Add TemplatePicker overlay rendering (alongside other overlays, e.g., after the PriorityPicker block):

```typescript
    {showTemplatePicker && (
      <TemplatePicker
        templates={templates}
        onSelect={(template) => {
          setShowTemplatePicker(false);
          setActiveTemplate(template);
          selectWorkItem(null);
          navigate('form');
        }}
        onCancel={() => {
          setShowTemplatePicker(false);
        }}
      />
    )}
```

Add `showTemplatePicker` to the `isActive` guard for the main input handler (the overlay should block other input — check the existing pattern for how `showPriorityPicker` etc. disable main input).

**Step 3: Modify WorkItemForm to accept template prefill**

In `src/components/WorkItemForm.tsx`, get `activeTemplate` and `setActiveTemplate` from `useAppState()` (add to destructuring at line 35-44).

Add an effect after the existing item sync effect (after line 199) to prefill from template:

```typescript
  // Prefill from template (create mode only)
  useEffect(() => {
    if (selectedWorkItemId !== null || !activeTemplate) return;
    if (activeTemplate.type != null) setType(activeTemplate.type);
    if (activeTemplate.status != null) setStatus(activeTemplate.status);
    if (activeTemplate.priority != null) setPriority(activeTemplate.priority);
    if (activeTemplate.assignee != null) setAssignee(activeTemplate.assignee);
    if (activeTemplate.labels != null)
      setLabels(activeTemplate.labels.join(', '));
    if (activeTemplate.iteration != null)
      setIteration(activeTemplate.iteration);
    if (activeTemplate.description != null)
      setDescription(activeTemplate.description);
    if (activeTemplate.parent != null) setParentId(String(activeTemplate.parent));
    if (activeTemplate.dependsOn != null)
      setDependsOn(activeTemplate.dependsOn.join(', '));
  }, [activeTemplate, selectedWorkItemId]);
```

Clear the active template on save (in the save function, after successful create):

```typescript
  setActiveTemplate(null);
```

**Step 4: Run build to verify types**

Run: `npm run build`
Expected: PASS

**Step 5: Run all tests**

Run: `npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/app.tsx src/components/WorkItemList.tsx src/components/WorkItemForm.tsx
git commit -m "feat: integrate TemplatePicker into create flow with form prefill"
```

---

### Task 6: Add Template Management to Settings Screen

**Files:**
- Modify: `src/components/Settings.tsx`
- Modify: `src/components/WorkItemForm.tsx` (template edit mode)
- Modify: `src/app.tsx` (add screen routing for template editing)

**Step 1: Extend Settings with template section**

In `src/components/Settings.tsx`, the component currently has a flat navigation model with `NavItem` union types. Add a new section for templates.

Add new nav item type:

```typescript
type NavItem =
  | { kind: 'backend'; backend: string }
  | { kind: 'jira-field'; field: 'site' | 'project' | 'boardId' }
  | { kind: 'template-header' }
  | { kind: 'template'; slug: string; name: string };
```

Add state for templates:

```typescript
  const [templates, setTemplates] = useState<Template[]>([]);
```

Import Template type and template functions. Load templates on mount from the backend.

Add template items to `navItems` (after existing items):

```typescript
  // Add template section
  if (backend capabilities support templates) {
    items.push({ kind: 'template-header' });
    for (const t of templates) {
      items.push({ kind: 'template', slug: t.slug, name: t.name });
    }
  }
```

Handle keyboard in navigation mode:
- Enter on a `template` item: navigate to form in template-edit mode (set `selectedWorkItemId` to a special value or add a new screen/mode)
- `c` key when cursor is on template section: create new template
- `d` key when cursor is on a template: delete with confirmation

Render template items with `>` cursor indicator, template name, and optional summary.

**Step 2: Add template form mode to WorkItemForm**

Add a `formMode` concept to `AppState`:

```typescript
  formMode: 'item' | 'template';
  setFormMode: (mode: 'item' | 'template') => void;
  editingTemplateSlug: string | null;
  setEditingTemplateSlug: (slug: string | null) => void;
```

In WorkItemForm, when `formMode === 'template'`:
- Change the header from "Create {type}" to "Create Template" / "Edit Template"
- Change `title` field label to "Name"
- Filter visible fields by `capabilities.templateFields` (only show fields the backend supports for templates)
- Hide comment field entirely
- On save: call `backend.createTemplate()` or `backend.updateTemplate()` instead of work item CRUD
- After save: queue the template sync action and navigate back to settings

**Step 3: Handle template deletion in Settings**

When `d` is pressed on a template nav item:
- Show confirmation (reuse existing confirm pattern from WorkItemList)
- On confirm: call `backend.deleteTemplate(slug)`, queue sync, refresh template list

**Step 4: Run build to verify types**

Run: `npm run build`
Expected: PASS

**Step 5: Run all tests**

Run: `npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/Settings.tsx src/components/WorkItemForm.tsx src/app.tsx
git commit -m "feat: add template management to Settings screen with form reuse"
```

---

### Task 7: Add Template Sync Queue Actions

**Files:**
- Modify: `src/sync/types.ts:1` (QueueAction type)
- Modify: `src/sync/SyncManager.ts:94-153` (pushEntry)

**Step 1: Extend QueueAction type**

In `src/sync/types.ts`, line 1, change:

```typescript
export type QueueAction = 'create' | 'update' | 'delete' | 'comment' | 'template-create' | 'template-update' | 'template-delete';
```

**Step 2: Add template-specific fields to QueueEntry**

In `src/sync/types.ts`, add to `QueueEntry`:

```typescript
  /** For templates: the template slug */
  templateSlug?: string;
```

**Step 3: Handle template actions in SyncManager.pushEntry()**

In `src/sync/SyncManager.ts`, add cases for template actions in `pushEntry()`:

```typescript
  case 'template-create':
  case 'template-update': {
    const local = this.local as LocalBackend;
    const template = await local.getTemplate(entry.templateSlug!);
    await this.remote.createTemplate(template);
    break;
  }
  case 'template-delete': {
    await this.remote.deleteTemplate(entry.templateSlug!);
    break;
  }
```

**Step 4: Run build**

Run: `npm run build`
Expected: PASS

**Step 5: Run all tests**

Run: `npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/sync/types.ts src/sync/SyncManager.ts
git commit -m "feat: add template sync queue actions to SyncManager"
```

---

### Task 8: Implement GitLab Template Sync

**Files:**
- Modify: `src/backends/gitlab/index.ts`

**Step 1: Implement GitLab template methods**

GitLab templates are stored in `.gitlab/issue_templates/{name}.md` in the repository. The GitLab API exposes repository files. Use `glab api` to read/write these files.

For `listTemplates()`: use `glab api` to list files in `.gitlab/issue_templates/` directory via the repository tree API.

For `createTemplate()` / `updateTemplate()`: use `glab api` to create/update a file at `.gitlab/issue_templates/{name}.md` with the template description as content (GitLab templates only support name + description).

For `deleteTemplate()`: use `glab api` to delete the file.

For `getTemplate()`: use `glab api` to read the file content.

Note: Only `name` (from filename) and `description` (from file content) are synced. Other fields in the local `.tic/templates/` file are preserved locally but not pushed to GitLab.

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Run tests**

Run: `npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/backends/gitlab/index.ts
git commit -m "feat: implement GitLab template sync via repository file API"
```

---

### Task 9: Add Template Pull to SyncManager

**Files:**
- Modify: `src/sync/SyncManager.ts:193-222` (pull method)

**Step 1: Add template pull logic**

In `SyncManager.pull()`, after pulling work items, also pull templates:

```typescript
  // Pull templates if supported
  const remoteCaps = this.remote.getCapabilities();
  if (remoteCaps.templates) {
    const remoteTemplates = await this.remote.listTemplates();
    const localTemplates = await this.local.listTemplates();
    const localSlugs = new Set(localTemplates.map((t) => t.slug));
    const remoteSlugs = new Set(remoteTemplates.map((t) => t.slug));

    // Write/update remote templates locally
    for (const rt of remoteTemplates) {
      await writeTemplate(this.local.getRoot(), rt);
    }

    // Delete local templates not on remote (unless pending in queue)
    for (const slug of localSlugs) {
      if (!remoteSlugs.has(slug) && !this.hasPendingTemplateAction(slug)) {
        await deleteTemplate(this.local.getRoot(), slug);
      }
    }
  }
```

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Run tests**

Run: `npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/sync/SyncManager.ts
git commit -m "feat: add template pull to SyncManager"
```

---

### Task 10: Update HelpScreen with Template Shortcuts

**Files:**
- Modify: `src/components/HelpScreen.tsx`

**Step 1: Add template-related shortcuts to help**

Add to the list screen section: `c` now mentions "create (with template selection if available)".

Add to the settings screen section: `c` for create template, `d` for delete template, Enter to edit template.

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/HelpScreen.tsx
git commit -m "feat: add template shortcuts to help screen"
```

---

### Task 11: Final Integration Testing and Cleanup

**Step 1: Run full test suite**

Run: `npm test`
Expected: All PASS

**Step 2: Run lint and format**

Run: `npm run lint && npm run format:check`
Expected: PASS

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Manual smoke test**

1. Start TUI: `npm start`
2. Go to Settings (`,`), verify Templates section appears
3. Create a template via Settings
4. Press `c` from list — verify TemplatePicker overlay appears
5. Select a template — verify form is prefilled
6. Select "No template" — verify empty form
7. Create an item from template — verify it saves correctly

**Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final cleanup for issue templates feature"
```
