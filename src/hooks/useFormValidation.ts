import { useState, useCallback } from 'react';
import type { WorkItem } from '../types.js';

interface FormFields {
  title: string;
  parentId: string;
  dependsOn: string;
}

/**
 * Parse an item reference like "#123 - Title" into just the ID "123".
 * Falls back to the raw trimmed input if no match.
 */
function parseItemId(raw: string): string {
  const match = raw.match(/^#(\S+)\s*-\s/);
  return match?.[1] ?? raw.trim();
}

/**
 * Detect circular parent chain: starting from parentId (display ID), walk parent pointers.
 * If we reach currentItemId, it's circular.
 * Note: item.parent is a rowId (number), so we use a rowId-keyed map to walk.
 */
function hasCircularParent(
  parentId: string,
  currentItemId: string,
  items: WorkItem[],
): boolean {
  const itemByDisplayId = new Map(
    items.filter((item) => item.id !== null).map((item) => [item.id!, item]),
  );
  const itemByRowId = new Map(items.map((item) => [item.rowId, item]));

  // Start with display ID lookup
  let currentItem = itemByDisplayId.get(parentId);
  const visited = new Set<number>();

  while (currentItem) {
    if (currentItem.id === currentItemId) return true;
    if (visited.has(currentItem.rowId)) return false; // cycle not involving current item
    visited.add(currentItem.rowId);
    if (currentItem.parent === null) break;
    currentItem = itemByRowId.get(currentItem.parent);
  }
  return false;
}

/**
 * Detect circular dependency: DFS from depId (display ID) following dependsOn edges.
 * If we reach currentItemId, it's circular.
 * Note: item.dependsOn contains rowIds (numbers), so we use a rowId-keyed map.
 */
function hasCircularDependency(
  depId: string,
  currentItemId: string,
  items: WorkItem[],
): boolean {
  const itemByDisplayId = new Map(
    items.filter((item) => item.id !== null).map((item) => [item.id!, item]),
  );
  const itemByRowId = new Map(items.map((item) => [item.rowId, item]));
  const visited = new Set<number>();

  // Start by resolving the display ID
  const startItem = itemByDisplayId.get(depId);
  if (!startItem) return false;
  const stack = [startItem.rowId];

  while (stack.length > 0) {
    const rowId = stack.pop()!;
    const item = itemByRowId.get(rowId);
    if (!item) continue;
    if (item.id === currentItemId) return true;
    if (visited.has(rowId)) continue;
    visited.add(rowId);
    for (const dep of item.dependsOn) {
      stack.push(dep);
    }
  }
  return false;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Pure validation function for form fields.
 */
export function validateFormFields(
  fields: FormFields,
  items: WorkItem[],
  currentItemId: string | null,
  requiredFields: string[],
  fieldValues?: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const itemMap = new Map(items.map((item) => [item.id, item]));

  // Check required fields
  for (const field of requiredFields) {
    if (field === 'title') {
      if (!fields.title.trim()) {
        errors['title'] = 'Title is required';
      }
    } else if (fieldValues && field in fieldValues) {
      if (!fieldValues[field]?.trim()) {
        errors[field] = `${capitalize(field)} is required`;
      }
    }
  }

  // Validate parent
  if (fields.parentId.trim()) {
    const parentId = parseItemId(fields.parentId);
    if (currentItemId && parentId === currentItemId) {
      errors['parentId'] = 'Cannot be its own parent';
    } else if (!itemMap.has(parentId)) {
      errors['parentId'] = `Parent #${parentId} does not exist`;
    } else if (
      currentItemId &&
      hasCircularParent(parentId, currentItemId, items)
    ) {
      errors['parentId'] = 'Circular parent chain detected';
    }
  }

  // Validate dependsOn
  if (fields.dependsOn.trim()) {
    const deps = fields.dependsOn.split(',').map((d) => d.trim());
    for (const dep of deps) {
      if (!dep) continue;
      const depId = parseItemId(dep);
      if (currentItemId && depId === currentItemId) {
        errors['dependsOn'] = 'Cannot depend on itself';
        break;
      } else if (!itemMap.has(depId)) {
        errors['dependsOn'] = `Dependency #${depId} does not exist`;
        break;
      } else if (
        currentItemId &&
        hasCircularDependency(depId, currentItemId, items)
      ) {
        errors['dependsOn'] = 'Circular dependency detected';
        break;
      }
    }
  }

  return errors;
}

/**
 * React hook wrapping validateFormFields with state management.
 */
export function useFormValidation(
  items: WorkItem[],
  currentItemId: string | null,
  requiredFields: string[],
) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = useCallback(
    (
      field: string,
      fields: FormFields,
      fieldValues?: Record<string, string>,
    ): boolean => {
      const allErrors = validateFormFields(
        fields,
        items,
        currentItemId,
        requiredFields,
        fieldValues,
      );

      if (field === 'all') {
        setErrors(allErrors);
        return Object.keys(allErrors).length > 0;
      }

      setErrors((prev) => {
        const next = { ...prev };
        if (allErrors[field]) {
          next[field] = allErrors[field];
        } else {
          delete next[field];
        }
        return next;
      });
      return !!allErrors[field];
    },
    [items, currentItemId, requiredFields],
  );

  const clearError = useCallback((field: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const hasErrors = Object.keys(errors).length > 0;

  return { errors, validate, clearError, hasErrors };
}
