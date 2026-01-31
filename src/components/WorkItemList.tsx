import { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { useAppState } from '../app.js';
import type { WorkItem } from '../types.js';

interface TreeItem {
  item: WorkItem;
  depth: number;
  prefix: string;
}

function buildTree(items: WorkItem[]): TreeItem[] {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const childrenMap = new Map<number | null, WorkItem[]>();

  for (const item of items) {
    const parentId =
      item.parent !== null && itemMap.has(item.parent) ? item.parent : null;
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId)!.push(item);
  }

  const result: TreeItem[] = [];

  function walk(parentId: number | null, depth: number, parentPrefix: string) {
    const children = childrenMap.get(parentId) ?? [];
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1;
      let prefix = '';
      if (depth > 0) {
        prefix = parentPrefix + (isLast ? '└─' : '├─');
      }
      result.push({ item: child, depth, prefix });
      const nextParentPrefix =
        depth > 0 ? parentPrefix + (isLast ? '  ' : '│ ') : '';
      walk(child.id, depth + 1, nextParentPrefix);
    });
  }

  walk(null, 0, '');
  return result;
}

export function WorkItemList() {
  const { backend, navigate, selectWorkItem, activeType, setActiveType } =
    useAppState();
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [warning, setWarning] = useState('');
  const [settingParent, setSettingParent] = useState(false);
  const [parentInput, setParentInput] = useState('');

  const types = useMemo(() => backend.getWorkItemTypes(), [backend]);

  useEffect(() => {
    if (activeType === null && types.length > 0) {
      setActiveType(types[0]!);
    }
  }, [activeType, types, setActiveType]);

  const iteration = backend.getCurrentIteration();
  const allItems = useMemo(
    () => backend.listWorkItems(iteration),
    [iteration, refresh],
  );
  const items = useMemo(
    () => allItems.filter((item) => item.type === activeType),
    [allItems, activeType],
  );
  const treeItems = useMemo(() => buildTree(items), [items]);
  const statuses = backend.getStatuses();

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, treeItems.length - 1)));
  }, [treeItems.length]);

  useInput((input, key) => {
    if (settingParent) {
      if (key.escape) {
        setSettingParent(false);
      }
      return;
    }

    if (confirmDelete) {
      if (input === 'y' || input === 'Y') {
        backend.deleteWorkItem(treeItems[cursor]!.item.id);
        setConfirmDelete(false);
        setCursor((c) => Math.max(0, c - 1));
        setRefresh((r) => r + 1);
      } else {
        setConfirmDelete(false);
      }
      return;
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      setWarning('');
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(treeItems.length - 1, c + 1));
      setWarning('');
    }

    if (key.return && treeItems.length > 0) {
      selectWorkItem(treeItems[cursor]!.item.id);
      navigate('form');
    }

    if (input === 'q') exit();
    if (input === 'i') navigate('iteration-picker');

    if (input === 'c') {
      selectWorkItem(null);
      navigate('form');
    }

    if (input === 'd' && treeItems.length > 0) {
      setConfirmDelete(true);
    }

    if (input === 'o' && treeItems.length > 0) {
      backend.openItem(treeItems[cursor]!.item.id);
      setRefresh((r) => r + 1);
    }

    if (input === 's' && treeItems.length > 0) {
      const item = treeItems[cursor]!.item;
      const idx = statuses.indexOf(item.status);
      const nextStatus = statuses[(idx + 1) % statuses.length]!;
      backend.updateWorkItem(item.id, { status: nextStatus });

      // Show warning if cycling to final status with open children or deps
      if (nextStatus === statuses[statuses.length - 1]) {
        const children = backend.getChildren(item.id);
        const openChildren = children.filter(
          (c) => c.status !== statuses[statuses.length - 1],
        );
        const unresolvedDeps = item.dependsOn
          .map((depId) => {
            try {
              return backend.getWorkItem(depId);
            } catch {
              return null;
            }
          })
          .filter(
            (d): d is WorkItem =>
              d !== null && d.status !== statuses[statuses.length - 1],
          );

        const warnings: string[] = [];
        if (openChildren.length > 0)
          warnings.push(`${openChildren.length} children still open`);
        if (unresolvedDeps.length > 0)
          warnings.push(
            unresolvedDeps
              .map((d) => `Depends on #${d.id} (${d.status})`)
              .join(', '),
          );
        if (warnings.length > 0) setWarning(warnings.join(' | '));
      } else {
        setWarning('');
      }

      setRefresh((r) => r + 1);
    }

    if (input === 'p' && treeItems.length > 0 && !settingParent) {
      setSettingParent(true);
      const currentParent = treeItems[cursor]!.item.parent;
      setParentInput(currentParent !== null ? String(currentParent) : '');
    }

    if (key.tab && types.length > 0) {
      const currentIdx = types.indexOf(activeType ?? '');
      const nextType = types[(currentIdx + 1) % types.length]!;
      setActiveType(nextType);
      setCursor(0);
      setWarning('');
    }
  });

  const typeLabel = activeType
    ? activeType.charAt(0).toUpperCase() + activeType.slice(1) + 's'
    : '';

  const colId = 5;
  const colStatus = 14;
  const colPriority = 10;
  const colAssignee = 12;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {typeLabel} — {iteration}
        </Text>
        <Text dimColor> ({items.length} items)</Text>
      </Box>

      <Box>
        <Box width={2}>
          <Text> </Text>
        </Box>
        <Box width={colId}>
          <Text bold underline>
            ID
          </Text>
        </Box>
        <Box flexGrow={1}>
          <Text bold underline>
            Title
          </Text>
        </Box>
        <Box width={colStatus}>
          <Text bold underline>
            Status
          </Text>
        </Box>
        <Box width={colPriority}>
          <Text bold underline>
            Priority
          </Text>
        </Box>
        <Box width={colAssignee}>
          <Text bold underline>
            Assignee
          </Text>
        </Box>
      </Box>

      {treeItems.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No {activeType}s in this iteration.</Text>
        </Box>
      )}
      {treeItems.map((treeItem, idx) => {
        const { item, prefix } = treeItem;
        const selected = idx === cursor;
        const hasUnresolvedDeps = item.dependsOn.length > 0;
        return (
          <Box key={item.id}>
            <Box width={2}>
              <Text color="cyan">{selected ? '>' : ' '}</Text>
            </Box>
            <Box width={colId}>
              <Text color={selected ? 'cyan' : undefined}>{item.id}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text color={selected ? 'cyan' : undefined} bold={selected}>
                {prefix}
                {item.title}
              </Text>
            </Box>
            <Box width={colStatus}>
              <Text color={selected ? 'cyan' : undefined}>
                {hasUnresolvedDeps ? '⧗ ' : ''}
                {item.status}
              </Text>
            </Box>
            <Box width={colPriority}>
              <Text color={selected ? 'cyan' : undefined}>{item.priority}</Text>
            </Box>
            <Box width={colAssignee}>
              <Text color={selected ? 'cyan' : undefined}>{item.assignee}</Text>
            </Box>
          </Box>
        );
      })}

      <Box marginTop={1}>
        {settingParent ? (
          <Box>
            <Text color="cyan">Set parent ID (empty to clear): </Text>
            <TextInput
              value={parentInput}
              onChange={setParentInput}
              focus={true}
              onSubmit={(value) => {
                const item = treeItems[cursor]!.item;
                const newParent =
                  value.trim() === '' ? null : parseInt(value.trim(), 10);
                try {
                  backend.updateWorkItem(item.id, { parent: newParent });
                  setWarning('');
                } catch (e) {
                  setWarning(e instanceof Error ? e.message : 'Invalid parent');
                }
                setSettingParent(false);
                setParentInput('');
                setRefresh((r) => r + 1);
              }}
            />
          </Box>
        ) : confirmDelete ? (
          <Text color="red">
            Delete item #{treeItems[cursor]?.item.id}? (y/n)
          </Text>
        ) : (
          <Text dimColor>
            up/down: navigate enter: edit o: open c: create d: delete s: cycle
            status p: set parent tab: type i: iteration q: quit
          </Text>
        )}
      </Box>
      {warning && (
        <Box>
          <Text color="yellow">⚠ {warning}</Text>
        </Box>
      )}
    </Box>
  );
}
