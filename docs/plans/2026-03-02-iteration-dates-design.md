# Iteration Start/End Dates Design

## Problem

Iterations are name-only strings throughout the system. Remote backends (GitLab, Jira, ADO) have date information but it's discarded. Users can't see when iterations start or end.

## Approach

Replace `string[]` with `Iteration[]` throughout the system (Approach A: structured iteration objects).

## Data Model

New `Iteration` interface in `src/types.ts`:

```typescript
export interface Iteration {
  name: string;
  startDate: string | null;  // ISO date YYYY-MM-DD
  endDate: string | null;    // ISO date YYYY-MM-DD
}
```

### Schema

Add nullable `start_date` and `end_date` TEXT columns to the `iterations` table via Drizzle migration.

### Config

`Config.iterations` changes from `string[]` to `Iteration[]`. `readConfig` maps rows to `Iteration` objects. `insertConfigTx` writes dates alongside names.

### Backend Interface

`getIterations()` returns `Promise<Iteration[]>` instead of `Promise<string[]>`.

## Auto-Detect Current Iteration

Shared utility `findCurrentIteration(iterations: Iteration[]): string | null` — returns the name of the iteration whose date range contains today, or `null` if none match.

`getCurrentIteration()` in Storage uses this: if an iteration's date range contains today, that iteration is current (overriding the stored value). If no match, falls back to the stored `current_iteration`.

## Backend Mappings

| Backend | Start Date Source | End Date Source |
|---------|------------------|-----------------|
| GitHub  | `null` (not available) | `GhMilestone.due_on` |
| GitLab  | `MilestoneNode.startDate` | `MilestoneNode.dueDate` |
| Jira    | `JiraSprint.startDate` | `JiraSprint.endDate` |
| ADO     | `attributes.startDate` | `attributes.finishDate` |
| Storage | `iterations.start_date` | `iterations.end_date` |

## UI Changes

### IterationPicker

Each row shows: `Sprint 1  Jan 6 - Jan 20  (active)`

- Date range: short month + day format
- Temporal status: `(active)` if today is in range, `(past)` if ended, `(upcoming)` if not started, omitted if no dates
- Dates in muted color
- Current iteration still marked with `(current)`

### WorkItemList Header

Changes from `Tasks - sprint-1` to `Tasks - Sprint 1 (Jan 6 - Jan 20)` when dates are available.

### Settings

Iteration management section gets two optional date input fields per iteration (YYYY-MM-DD format). Read-only for remote backends.

### CLI `tic iteration list`

Table output with columns: Name, Start, End, Status. JSON output includes full `Iteration` objects.

### MCP `tic-get_config`

The `iterations` field becomes `Iteration[]`.

## Partial Date Handling

Show whatever dates are available. If only end date exists (GitHub), display as `due Jan 20`. If only start date, display as `from Jan 6`.
