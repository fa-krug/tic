import { useState, useEffect, useCallback } from 'react';
import type { Backend, BackendCapabilities } from '../backends/types.js';
import type { WorkItem } from '../types.js';

export interface BackendData {
  capabilities: BackendCapabilities;
  statuses: string[];
  iterations: string[];
  types: string[];
  assignees: string[];
  currentIteration: string;
  items: WorkItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useBackendData(
  backend: Backend,
  iteration?: string,
): BackendData {
  const capabilities = backend.getCapabilities(); // sync — no I/O

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [iterations, setIterations] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [currentIteration, setCurrentIteration] = useState('');
  const [items, setItems] = useState<WorkItem[]>([]);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const refresh = useCallback(() => {
    setRefreshCounter((c) => c + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const iter = iteration ?? (await backend.getCurrentIteration());
        const [s, it, t, a, wi] = await Promise.all([
          backend.getStatuses(),
          backend.getIterations(),
          backend.getWorkItemTypes(),
          backend.getAssignees().catch(() => [] as string[]),
          backend.listWorkItems(iter),
        ]);
        if (cancelled) return;
        setStatuses(s);
        setIterations(it);
        setTypes(t);
        setAssignees(a);
        setCurrentIteration(iter);
        setItems(wi);
        setError(null);
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
    currentIteration,
    items,
    loading,
    error,
    refresh,
  };
}
