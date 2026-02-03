import { useState, useEffect, useCallback, useRef } from 'react';
import type { Backend, BackendCapabilities } from '../backends/types.js';
import type { WorkItem } from '../types.js';

export interface BackendData {
  capabilities: BackendCapabilities;
  statuses: string[];
  iterations: string[];
  types: string[];
  assignees: string[];
  labels: string[];
  currentIteration: string;
  items: WorkItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// Module-level cache so data persists across component unmount/remount
interface CachedData {
  statuses: string[];
  iterations: string[];
  types: string[];
  assignees: string[];
  labels: string[];
  currentIteration: string;
  items: WorkItem[];
}
let dataCache: CachedData | null = null;

export function useBackendData(
  backend: Backend,
  iteration?: string,
): BackendData {
  const capabilities = backend.getCapabilities(); // sync — no I/O

  // Check cache at mount time and store in ref (won't change during lifecycle)
  const hadCacheAtMount = useRef(dataCache !== null);

  // Use cached data if available, otherwise start with loading state
  const [loading, setLoading] = useState(!hadCacheAtMount.current);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<string[]>(dataCache?.statuses ?? []);
  const [iterations, setIterations] = useState<string[]>(
    dataCache?.iterations ?? [],
  );
  const [types, setTypes] = useState<string[]>(dataCache?.types ?? []);
  const [assignees, setAssignees] = useState<string[]>(
    dataCache?.assignees ?? [],
  );
  const [labels, setLabels] = useState<string[]>(dataCache?.labels ?? []);
  const [currentIteration, setCurrentIteration] = useState(
    dataCache?.currentIteration ?? '',
  );
  const [items, setItems] = useState<WorkItem[]>(dataCache?.items ?? []);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Track if this is the initial mount to avoid showing loading on return
  const isInitialMount = useRef(true);

  const refresh = useCallback(() => {
    setRefreshCounter((c) => c + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Only show loading if:
    // - No cache at mount time and this is initial mount, OR
    // - This is an explicit refresh (not initial mount)
    const showLoading = !hadCacheAtMount.current || !isInitialMount.current;
    if (showLoading) {
      setLoading(true);
    }
    isInitialMount.current = false;

    async function load() {
      try {
        const iter = iteration ?? (await backend.getCurrentIteration());
        const [s, it, t, a, l, wi] = await Promise.all([
          backend.getStatuses(),
          backend.getIterations(),
          backend.getWorkItemTypes(),
          backend.getAssignees().catch(() => [] as string[]),
          backend.getLabels().catch(() => [] as string[]),
          backend.listWorkItems(iter),
        ]);
        if (cancelled) return;
        setStatuses(s);
        setIterations(it);
        setTypes(t);
        setAssignees(a);
        setLabels(l);
        setCurrentIteration(iter);
        setItems(wi);
        setError(null);
        // Update cache
        dataCache = {
          statuses: s,
          iterations: it,
          types: t,
          assignees: a,
          labels: l,
          currentIteration: iter,
          items: wi,
        };
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [backend, iteration, refreshCounter]);

  return {
    capabilities,
    statuses,
    iterations,
    types,
    assignees,
    labels,
    currentIteration,
    items,
    loading,
    error,
    refresh,
  };
}

// Export for testing
export function clearBackendDataCache() {
  dataCache = null;
}
