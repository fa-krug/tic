import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export interface FormFields {
  title: string;
  type: string;
  status: string;
  iteration: string;
  priority: string;
  assignee: string;
  labels: string;
  description: string;
  parentId: string;
  dependsOn: string;
  newComment: string;
}

export interface FormDraft {
  itemId: string | null;
  itemTitle: string;
  fields: FormFields;
  initialSnapshot: FormFields;
  focusedField: number;
}

interface FormStackState {
  stack: FormDraft[];
  showDiscardPrompt: boolean;

  push: (draft: FormDraft) => void;
  pop: () => FormDraft | undefined;
  updateFields: (fields: Partial<FormFields>) => void;
  setFocusedField: (index: number) => void;
  isDirty: () => boolean;
  isFieldDirty: (key: keyof FormFields) => boolean;
  setShowDiscardPrompt: (show: boolean) => void;
  clear: () => void;
  currentDraft: () => FormDraft | undefined;
}

function fieldsEqual(a: FormFields, b: FormFields): boolean {
  return (
    a.title === b.title &&
    a.type === b.type &&
    a.status === b.status &&
    a.iteration === b.iteration &&
    a.priority === b.priority &&
    a.assignee === b.assignee &&
    a.labels === b.labels &&
    a.description === b.description &&
    a.parentId === b.parentId &&
    a.dependsOn === b.dependsOn &&
    a.newComment === b.newComment
  );
}

export const formStackStore = createStore<FormStackState>((set, get) => ({
  stack: [],
  showDiscardPrompt: false,

  push: (draft) =>
    set((state) => ({
      stack: [...state.stack, draft],
    })),

  pop: () => {
    const { stack } = get();
    if (stack.length === 0) return undefined;
    const popped = stack[stack.length - 1]!;
    set({ stack: stack.slice(0, -1) });
    return popped;
  },

  currentDraft: () => {
    const { stack } = get();
    return stack.length > 0 ? stack[stack.length - 1] : undefined;
  },

  updateFields: (fields) =>
    set((state) => {
      if (state.stack.length === 0) return state;
      const updated = [...state.stack];
      const current = updated[updated.length - 1]!;
      updated[updated.length - 1] = {
        ...current,
        fields: { ...current.fields, ...fields },
      };
      return { stack: updated };
    }),

  setFocusedField: (index) =>
    set((state) => {
      if (state.stack.length === 0) return state;
      const updated = [...state.stack];
      const current = updated[updated.length - 1]!;
      updated[updated.length - 1] = { ...current, focusedField: index };
      return { stack: updated };
    }),

  isDirty: () => {
    const current = get().currentDraft();
    if (!current) return false;
    return !fieldsEqual(current.fields, current.initialSnapshot);
  },

  isFieldDirty: (key: keyof FormFields) => {
    const current = get().currentDraft();
    if (!current) return false;
    return current.fields[key] !== current.initialSnapshot[key];
  },

  setShowDiscardPrompt: (show) => set({ showDiscardPrompt: show }),

  clear: () => set({ stack: [], showDiscardPrompt: false }),
}));

export function useFormStackStore<T>(
  selector: (state: FormStackState) => T,
): T {
  return useStore(formStackStore, selector);
}
