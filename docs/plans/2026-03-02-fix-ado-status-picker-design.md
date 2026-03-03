# Fix Duplicate Statuses and Missing Colors in ADO Backend Status Picker

## Problem

1. The status picker (OverlayPanel) shows each status name **twice** per row when `fieldType` is set — once via `ColorPill` and once via the separate `item.label` text.
2. Some statuses render without colored pills because `resolveFieldColor()` returns null for values that don't match any keyword default pattern.

## Root Cause

### Duplicate text

In `OverlayPanel.tsx` (lines 245-255), when `fieldType` is set:
- `ColorPill` renders the status value as colored text
- `item.label` renders the same value as plain text
- Both appear side by side: "To Do To Do"

### Missing colors

In `themeStore.ts`, `resolveFieldColor()` checks: user override → keyword defaults → label hash (labels only) → null. For statuses, there is no hash-based fallback, so statuses that don't match any keyword pattern (e.g., "Resolved", "Design") render as unstyled plain text.

## Solution

### Fix 1: OverlayPanel — hide label when ColorPill is shown

When `fieldType` is present, the `ColorPill` replaces the label entirely. Only render the plain `item.label` text when there is no `fieldType`.

**File:** `src/components/OverlayPanel.tsx`

### Fix 2: themeStore — hash fallback + more keyword defaults

1. Add keyword defaults for common ADO statuses:
   - `"resolved"` → green (completed state)
   - `"removed"` → red (deletion state)
   - `"design"` → cyan (ADO Agile process state)

2. Extend `resolveFieldColor()` to apply hash-based color fallback for `status`, `type`, and `priority` fields (not just labels). This ensures every value always gets a color.

**File:** `src/stores/themeStore.ts`

## Files Changed

| File | Change |
|------|--------|
| `src/components/OverlayPanel.tsx` | Conditional label rendering (~3 lines) |
| `src/stores/themeStore.ts` | Add keyword defaults + hash fallback (~5 lines) |

## Testing

- Extend themeStore tests to verify hash fallback for status/type/priority fields
- Verify OverlayPanel renders no duplicate text when `fieldType` is set
- ADO `getStatuses` dedup test already passes (no change needed)
