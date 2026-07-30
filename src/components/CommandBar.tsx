import { useState, useMemo, useCallback } from 'react';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import {
  navigationStore,
  useNavigationStore,
} from '../stores/navigationStore.js';
import { useShallow } from 'zustand/shallow';
import {
  recentCommandsStore,
  useRecentCommandsStore,
} from '../stores/recentCommandsStore.js';
import { OverlayPanel, type OverlayItem } from './OverlayPanel.js';
import type { Command } from '../commands.js';

interface CommandBarProps {
  commands: Command[];
  onCommand: (cmd: Command) => void;
  onCancel: () => void;
}

export function CommandBar({ commands, onCommand, onCancel }: CommandBarProps) {
  const [query, setQuery] = useState('');
  // Search deliberately ignores the list's iteration scope, type view and
  // active filters — the store holds every item, and hits are matched here.
  const allSearchItems = useBackendDataStore((s) => s.items);
  const recentIds = useRecentCommandsStore((s) => s.recentIds);
  const { pullRequests, branches } = useBackendDataStore(
    useShallow((s) => ({
      pullRequests: s.pullRequests,
      branches: s.branches,
    })),
  );
  const { navigate } = navigationStore.getState();
  const screen = useNavigationStore((s) => s.screen);

  const items: OverlayItem[] = useMemo(() => {
    const q = query.toLowerCase();

    // Build command items (recent + categorized)
    const commandMap = new Map(commands.map((c) => [c.id, c]));
    const recentItems: OverlayItem[] = [];
    for (const id of recentIds) {
      const cmd = commandMap.get(id);
      if (cmd) {
        recentItems.push({
          id: `recent-${cmd.id}`,
          label: cmd.label,
          value: cmd.id,
          category: 'Recent',
          kind: 'command',
        });
      }
    }

    const commandItems: OverlayItem[] = commands.map((cmd) => ({
      id: cmd.id,
      label: cmd.label,
      value: cmd.id,
      category: cmd.category,
      kind: 'command' as const,
    }));

    let all = [...recentItems, ...commandItems];

    if (q) {
      all = all.filter((item) => item.label.toLowerCase().includes(q));

      // Add matching issues (up to 5)
      const matchingIssues = allSearchItems
        .filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            (item.id !== null && item.id.toLowerCase().includes(q)),
        )
        .slice(0, 5)
        .map((item) => ({
          id: `issue-${item.rowId}`,
          label: `#${item.id ?? item.rowId} ${item.title}`,
          value: String(item.rowId),
          hint: item.type,
          category: 'Issues',
          kind: 'issue' as const,
        }));

      // Add matching PRs (up to 5)
      const matchingPrs = pullRequests
        .filter(
          (pr) =>
            pr.title.toLowerCase().includes(q) || String(pr.number).includes(q),
        )
        .slice(0, 5)
        .map((pr) => ({
          id: `pr-${pr.id}`,
          label: `PR #${pr.number} ${pr.title}`,
          value: pr.id,
          hint: pr.status,
          category: 'Pull Requests',
          kind: 'pr' as const,
        }));

      // Add matching branches (up to 5)
      const matchingBranches = branches
        .filter(
          (r) =>
            r.branch.name.toLowerCase().includes(q) ||
            r.linkedItem?.title.toLowerCase().includes(q),
        )
        .slice(0, 5)
        .map((r) => ({
          id: `branch-${r.branch.name}`,
          label: r.branch.name,
          value: r.branch.name,
          hint: r.linkedItem
            ? `#${r.linkedItem.id ?? r.linkedItem.rowId} ${r.linkedItem.title}`
            : undefined,
          category: 'Branches',
          kind: 'branch' as const,
        }));

      all = [...all, ...matchingIssues, ...matchingPrs, ...matchingBranches];
    }

    return all;
  }, [commands, recentIds, query, allSearchItems, pullRequests, branches]);

  const handleSelect = useCallback(
    (item: OverlayItem) => {
      setQuery('');
      if (item.kind === 'issue') {
        const rowId = Number(item.value);
        const workItem = allSearchItems.find((i) => i.rowId === rowId);
        if (workItem) {
          navigationStore.getState().selectWorkItem(workItem.rowId);
          if (screen !== 'list') navigate('list');
          navigate('form');
        }
        onCancel();
        return;
      }
      if (item.kind === 'pr') {
        navigationStore.getState().selectPr(item.value);
        if (screen !== 'pr-list') navigate('pr-list');
        onCancel();
        return;
      }
      if (item.kind === 'branch') {
        navigationStore.getState().selectBranch(item.value);
        if (screen !== 'branch-list') navigate('branch-list');
        onCancel();
        return;
      }
      // Command
      const cmd = commands.find((c) => c.id === item.value);
      if (cmd) {
        recentCommandsStore.getState().addRecent(cmd.id);
        onCommand(cmd);
      }
    },
    [allSearchItems, commands, onCommand, onCancel, screen, navigate],
  );

  return (
    <OverlayPanel
      title="Search & Commands"
      items={items}
      placeholder="Search items, PRs, branches… or type a command"
      externalFilter
      onQueryChange={setQuery}
      onSelect={handleSelect}
      onCancel={() => {
        setQuery('');
        onCancel();
      }}
    />
  );
}
