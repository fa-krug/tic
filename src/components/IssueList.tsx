import { useState, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { useAppState } from '../app.js';

export function IssueList() {
  const { backend, navigate, selectIssue } = useAppState();
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const iteration = backend.getCurrentIteration();
  const issues = useMemo(
    () => backend.listIssues(iteration),
    [iteration, refresh],
  );
  const statuses = backend.getStatuses();

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === 'y' || input === 'Y') {
        backend.deleteIssue(issues[cursor]!.id);
        setConfirmDelete(false);
        setCursor((c) => Math.max(0, c - 1));
        setRefresh((r) => r + 1);
      } else {
        setConfirmDelete(false);
      }
      return;
    }

    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(issues.length - 1, c + 1));

    if (key.return && issues.length > 0) {
      selectIssue(issues[cursor]!.id);
      navigate('form');
    }

    if (input === 'q') exit();
    if (input === 'i') navigate('iteration-picker');

    if (input === 'c') {
      selectIssue(null);
      navigate('form');
    }

    if (input === 'd' && issues.length > 0) {
      setConfirmDelete(true);
    }

    if (input === 's' && issues.length > 0) {
      const issue = issues[cursor]!;
      const idx = statuses.indexOf(issue.status);
      const nextStatus = statuses[(idx + 1) % statuses.length]!;
      backend.updateIssue(issue.id, { status: nextStatus });
      setRefresh((r) => r + 1);
    }
  });

  const colId = 5;
  const colStatus = 14;
  const colPriority = 10;
  const colAssignee = 12;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Iteration: {iteration}
        </Text>
        <Text dimColor> ({issues.length} issues)</Text>
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

      {issues.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No issues in this iteration.</Text>
        </Box>
      )}
      {issues.map((issue, idx) => {
        const selected = idx === cursor;
        return (
          <Box key={issue.id}>
            <Box width={2}>
              <Text color="cyan">{selected ? '>' : ' '}</Text>
            </Box>
            <Box width={colId}>
              <Text color={selected ? 'cyan' : undefined}>{issue.id}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text color={selected ? 'cyan' : undefined} bold={selected}>
                {issue.title}
              </Text>
            </Box>
            <Box width={colStatus}>
              <Text color={selected ? 'cyan' : undefined}>{issue.status}</Text>
            </Box>
            <Box width={colPriority}>
              <Text color={selected ? 'cyan' : undefined}>
                {issue.priority}
              </Text>
            </Box>
            <Box width={colAssignee}>
              <Text color={selected ? 'cyan' : undefined}>
                {issue.assignee}
              </Text>
            </Box>
          </Box>
        );
      })}

      <Box marginTop={1}>
        {confirmDelete ? (
          <Text color="red">Delete issue #{issues[cursor]?.id}? (y/n)</Text>
        ) : (
          <Text dimColor>
            up/down: navigate enter: open c: create d: delete s: cycle status i:
            iteration q: quit
          </Text>
        )}
      </Box>
    </Box>
  );
}
