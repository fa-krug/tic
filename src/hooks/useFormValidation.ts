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
 * Detect circular parent chain: starting from parentId, walk parent pointers.
 * If we reach currentItemId, it's circular.
 */
function hasCircularParent(
  parentId: string,
  currentItemId: string,
  items: WorkItem[],
): boolean {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  let cursor: string | null = parentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === currentItemId) return true;
    if (visited.has(cursor)) return false; // cycle not involving current item
    visited.add(cursor);
    const item = itemMap.get(cursor);
    cursor = item?.parent ?? null;
  }
  return false;
}

/**
 * Detect circular dependency: DFS from depId following dependsOn edges.
 * If we reach currentItemId, it's circular.
 */
function hasCircularDependency(
  depId: string,
  currentItemId: string,
  items: WorkItem[],
): boolean {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const visited = new Set<string>();
  const stack = [depId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === currentItemId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const item = itemMap.get(id);
    if (item) {
      for (const dep of item.dependsOn) {
        stack.push(dep);
      }
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
