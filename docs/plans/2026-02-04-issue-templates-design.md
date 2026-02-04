# Issue Templates Design

## Overview

Add support for issue templates that pre-fill work item fields on create. Templates are stored as markdown files with YAML frontmatter in `.tic/templates/`, following the same pattern as work items. Starting with GitLab backend sync; other backends get local-only template support.

## Data Model

### Storage

Templates live in `.tic/templates/{slug}.md`. The slug is derived from the template name (e.g., "Bug Report" becomes `bug-report.md`).

### Template File Format

```markdown
---
name: Bug Report
type: bug
priority: high
labels: [bug, needs-triage]
---

## Steps to Reproduce

1.

## Expected Behavior

## Actual Behavior
```

- **`name`** (required) — display name of the template
- All other fields are optional — omitted fields don't prefill (form uses its normal defaults)
- Body is the description template
- ID = slugified name, no numeric ID tracking needed

### Template Type

```typescript
export interface Template {
  slug: string;       // slugified name, used as filename/ID
  name: string;       // display name (required)
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

## Template Capabilities

Each backend declares which fields its templates support, separate from work item capabilities.

```typescript
// Added to BackendCapabilities
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
}
```

- `name` is always required and not gated by capabilities.

### Per-Backend Template Capabilities

| Field       | Local | GitLab          | GitHub | ADO | Jira |
|-------------|-------|-----------------|--------|-----|------|
| name        | yes   | yes             | -      | -   | -    |
| description | yes   | yes             | -      | -   | -    |
| type        | yes   | no              | -      | -   | -    |
| status      | yes   | no              | -      | -   | -    |
| priority    | yes   | no              | -      | -   | -    |
| assignee    | yes   | no              | -      | -   | -    |
| labels      | yes   | no              | -      | -   | -    |
| iteration   | yes   | no              | -      | -   | -    |
| parent      | yes   | no              | -      | -   | -    |
| dependsOn   | yes   | no              | -      | -   | -    |

GitHub, ADO, and Jira have no template support yet (dash = not implemented).

## TUI Create Flow

### Current Flow

User presses `c` -> navigates to WorkItemForm in create mode.

### New Flow

User presses `c` -> if templates exist, show TemplatePicker overlay -> user selects template or "No template" -> navigate to WorkItemForm with prefilled values.

If no templates exist, skip the overlay entirely. Zero behavior change for users without templates.

### TemplatePicker Overlay

- Inline overlay component (consistent with PriorityPicker, StatusPicker, TypePicker)
- First option: "No template" (default, highlighted)
- Remaining options: template names loaded from `.tic/templates/`
- Keyboard: arrow keys to navigate, Enter to select, Escape to cancel (back to list)
- On selection: pass template field values to the form as initial state

### WorkItemForm Prefill

- Accept optional template data containing prefill values
- Initialize form fields from the template instead of empty defaults
- `name` is not carried over (title starts empty — user always enters a fresh title)
- Description gets the template body
- Only fields present in the template override defaults; missing fields use normal defaults

## Settings Screen — Template Management

### Template List

New section in Settings: "Templates" with a list of existing templates.

- Arrow keys to navigate templates
- Enter to edit
- `c` to create new
- `d` to delete
- Escape to go back
- Shows template name and summary (type, priority if set)

### Create/Edit Template

Reuses WorkItemForm with a `template` form mode:

- Title field repurposed as "Name" (label changes)
- Fields shown are filtered by the backend's `templateFields` capabilities
- All fields optional except name
- No comment field shown
- On save: writes to `.tic/templates/{slug}.md`
- After save: sync triggers

### Delete Template

Confirmation prompt, then removes the file and syncs.

## Sync & Backend Integration

Templates sync using the same mechanism as work items.

### GitLab Sync

- **Push:** writes template to `.gitlab/issue_templates/{name}.md` in the repo (via `glab` CLI or GitLab API). Only name + description are synced (matching GitLab's native model). Extra frontmatter fields are local-only.
- **Pull:** reads `.gitlab/issue_templates/*.md` from the repo and writes to `.tic/templates/`. Template name maps to the filename.
- Queue store tracks template mutations (`template-create`, `template-update`, `template-delete`).

### Local Backend

No remote sync. `.tic/templates/` is the source of truth. All fields stored and used as-is.

### Other Backends

Not implemented yet. Templates remain local-only until those backends get sync support. The local `.tic/templates/` files still work for the TUI create flow regardless.

## File Changes

### New Files

- `src/components/TemplatePicker.tsx` — inline overlay for template selection on create
- `.tic/templates/` — directory for template storage (created on first template)

### Modified Files

| File | Change |
|------|--------|
| `src/backends/types.ts` | Add `templateFields` to `BackendCapabilities`, add template CRUD to `Backend` interface |
| `src/backends/local/index.ts` | Implement template CRUD (read/write/delete `.tic/templates/*.md`) |
| `src/backends/gitlab/index.ts` | Implement template sync (push/pull `.gitlab/issue_templates/`) |
| `src/backends/github/index.ts` | Return empty template capabilities |
| `src/backends/ado/index.ts` | Return empty template capabilities |
| `src/backends/jira/index.ts` | Return empty template capabilities |
| `src/components/WorkItemList.tsx` | On `c` press: check for templates, show TemplatePicker if any exist |
| `src/components/WorkItemForm.tsx` | Accept template prefill data, support template form mode |
| `src/components/Settings.tsx` | Add template management section |
| `src/app.tsx` | Add template-related state to context |
| `src/types.ts` | Add `Template` type |

## Not in Scope

- CLI template commands (`tic template list/create/edit/delete`)
- `--template` flag on `tic item create`
- GitHub, ADO, Jira template sync
- Template import/export
