import { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { useAppState } from '../app.js';

export function WorkItemList() {
  const { backend, navigate, selectWorkItem, activeType, setActiveType } =
    useAppState();
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refresh, setRefresh] = useState(0);

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
  const statuses = backend.getStatuses();

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, items.length - 1)));
  }, [items.length]);

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === 'y' || input === 'Y') {
        backend.deleteWorkItem(items[cursor]!.id);
        setConfirmDelete(false);
        setCursor((c) => Math.max(0, c - 1));
        setRefresh((r) => r + 1);
      } else {
        setConfirmDelete(false);
      }
      return;
    }

    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(items.length - 1, c + 1));

    if (key.return && items.length > 0) {
      selectWorkItem(items[cursor]!.id);
      navigate('form');
    }

    if (input === 'q') exit();
    if (input === 'i') navigate('iteration-picker');

    if (input === 'c') {
      selectWorkItem(null);
      navigate('form');
    }

    if (input === 'd' && items.length > 0) {
      setConfirmDelete(true);
    }

    if (input === 's' && items.length > 0) {
      const item = items[cursor]!;
      const idx = statuses.indexOf(item.status);
      const nextStatus = statuses[(idx + 1) % statuses.length]!;
      backend.updateWorkItem(item.id, { status: nextStatus });
      setRefresh((r) => r + 1);
    }

    if (key.tab && types.length > 0) {
      const currentIdx = types.indexOf(activeType ?? '');
      const nextType = types[(currentIdx + 1) % types.length]!;
      setActiveType(nextType);
      setCursor(0);
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

      {items.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No {activeType}s in this iteration.</Text>
        </Box>
      )}
      {items.map((item, idx) => {
        const selected = idx === cursor;
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
                {item.title}
              </Text>
            </Box>
            <Box width={colStatus}>
              <Text color={selected ? 'cyan' : undefined}>{item.status}</Text>
            </Box>
            <Box width={colPriority}>
              <Text color={selected ? 'cyan' : undefined}>
                {item.priority}
              </Text>
            </Box>
            <Box width={colAssignee}>
              <Text color={selected ? 'cyan' : undefined}>
                {item.assignee}
              </Text>
            </Box>
          </Box>
        );
      })}

      <Box marginTop={1}>
        {confirmDelete ? (
          <Text color="red">Delete item #{items[cursor]?.id}? (y/n)</Text>
        ) : (
          <Text dimColor>
            up/down: navigate enter: open c: create d: delete s: cycle status
            tab: type i: iteration q: quit
          </Text>
        )}
      </Box>
    </Box>
  );
}
