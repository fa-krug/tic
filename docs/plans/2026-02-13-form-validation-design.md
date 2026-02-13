# Real-time Form Validation Design

**Issue:** #17 — Add real-time field validation feedback in form
**Date:** 2026-02-13
**Approach:** Form-level validation hook (Approach A)

## Overview

Add real-time validation to WorkItemForm that validates fields on input commit (suggestion select, comma type, or focus leave). Errors display as inline red text below the invalid field. Save is blocked when errors exist.

## Validation Hook

New `useFormValidation` hook that takes form field values, the items list from `backendDataStore`, the current item ID (edit mode), and backend capabilities. Returns:

- `errors: Record<string, string>` — field name to error message
- `validate(field: string): void` — trigger validation for a specific field (or `'all'`)
- `hasErrors: boolean`

### Validation Rules

- **title**: required → `"Title is required"`
- **parent**: ID exists → `"Parent #X does not exist"`, not self → `"Cannot be its own parent"`, no cycles → `"Circular parent chain detected"`
- **dependsOn**: each ID exists → `"Dependency #X does not exist"`, not self → `"Cannot depend on itself"`, no cycles → `"Circular dependency detected"`
- **Required fields**: declared by backend via `requiredFields` in capabilities → `"[Field] is required"`

All checks run against the in-memory items array from `backendDataStore`. No async calls.

## Validation Triggers

- **Parent field**: on suggestion select or `onChange` with complete value
- **DependsOn field**: on comma type (committing a segment) or suggestion select
- **Title / required fields**: on focus leave (navigating to another field)
- **Save (`s` key)**: calls `validate('all')`. If `hasErrors`, shows toast `"Fix validation errors before saving"` and returns early.

## Inline Error Display

Red text line rendered below the invalid field, only when an error exists:

```
Parent:   #999 - ???
          Circular parent chain detected
```

Implemented as `<Text color="red">{errors[field]}</Text>` after each field's input element. One error message per field (for `dependsOn`, shows first error found). No layout shift when fields are valid — the line simply doesn't render.

## Required Fields in Capabilities

Add optional `requiredFields` to `BackendCapabilities`:

```typescript
requiredFields?: string[]  // defaults to ['title'] if not specified
```

Each backend sets this in `getCapabilities()`. The validation hook reads it to determine which empty fields are errors.

## Testing

Unit tests for the validation hook in `useFormValidation.test.ts`:

- Title empty → error
- Parent: doesn't exist, self-reference, circular chain → errors
- Parent: valid → no error
- DependsOn: doesn't exist, self-reference, circular chain → errors
- DependsOn: valid → no error
- Required fields from capabilities → error when empty
- Multiple simultaneous errors → all returned

Pure function tests — no rendering or backend needed. Backend validation at save time remains as a safety net.

## Rejected Approaches

- **Backend `validate()` method** (Approach B): Adds async overhead and interface bloat for validation that can be done in-memory.
- **Shared validation utilities** (Approach C): Storage uses SQL queries while form uses arrays — abstracting over the data source adds complexity for minimal gain.
