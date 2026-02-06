import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export type ActiveOverlay =
  // WorkItemList overlays
  | { type: 'search' }
  | { type: 'command-palette' }
  | { type: 'bulk-menu' }
  | { type: 'delete-confirm'; targetIds: string[] }
  | { type: 'template-picker' }
  | { type: 'status-picker'; targetIds: string[] }
  | { type: 'type-picker'; targetIds: string[] }
  | { type: 'priority-picker'; targetIds: string[] }
  | { type: 'parent-input'; targetIds: string[] }
  | { type: 'assignee-input'; targetIds: string[] }
  | { type: 'labels-input'; targetIds: string[] }
  // Settings overlays
  | { type: 'default-type-picker' }
  | { type: 'default-iteration-picker' }
  | { type: 'delete-template-confirm'; templateSlug: string }
  | { type: 'settings-edit' };

export interface UIStoreState {
  activeOverlay: ActiveOverlay | null;
  warning: string;
  toast: { message: string; timestamp: number } | null;

  openOverlay: (overlay: ActiveOverlay) => void;
  closeOverlay: () => void;
  setWarning: (msg: string) => void;
  clearWarning: () => void;
  setToast: (msg: string) => void;
  clearToast: () => void;
  reset: () => void;
}

export const uiStore = createStore<UIStoreState>((set) => ({
  activeOverlay: null,
  warning: '',
  toast: null,

  openOverlay: (overlay) => set({ activeOverlay: overlay }),
  closeOverlay: () => set({ activeOverlay: null }),
  setWarning: (msg) => set({ warning: msg }),
  clearWarning: () => set({ warning: '' }),
  setToast: (msg) => set({ toast: { message: msg, timestamp: Date.now() } }),
  clearToast: () => set({ toast: null }),
  reset: () => set({ activeOverlay: null, warning: '', toast: null }),
}));

export function useUIStore<T>(selector: (state: UIStoreState) => T): T {
  return useStore(uiStore, selector);
}

/** Type guard: returns targetIds if the current overlay carries them, else empty array. */
export function getOverlayTargetIds(): string[] {
  const overlay = uiStore.getState().activeOverlay;
  if (overlay && 'targetIds' in overlay) return overlay.targetIds;
  return [];
}
