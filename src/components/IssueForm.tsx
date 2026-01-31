import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { useAppState } from '../app.js';
import type { Comment } from '../types.js';

type FieldName = 'title' | 'status' | 'iteration' | 'priority' | 'assignee' | 'labels' | 'description' | 'comments';

const FIELDS: FieldName[] = ['title', 'status', 'iteration', 'priority', 'assignee', 'labels', 'description', 'comments'];
const SELECT_FIELDS: FieldName[] = ['status', 'iteration', 'priority'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

export function IssueForm() {
  const { backend, navigate, selectedIssueId } = useAppState();

  const statuses = useMemo(() => backend.getStatuses(), [backend]);
  const iterations = useMemo(() => backend.getIterations(), [backend]);

  const existingIssue = useMemo(
    () => (selectedIssueId !== null ? backend.getIssue(selectedIssueId) : null),
    [selectedIssueId, backend],
  );

  const [title, setTitle] = useState(existingIssue?.title ?? '');
  const [status, setStatus] = useState(existingIssue?.status ?? statuses[0] ?? '');
  const [iteration, setIteration] = useState(existingIssue?.iteration ?? backend.getCurrentIteration());
  const [priority, setPriority] = useState(existingIssue?.priority ?? 'medium');
  const [assignee, setAssignee] = useState(existingIssue?.assignee ?? '');
  const [labels, setLabels] = useState(existingIssue?.labels.join(', ') ?? '');
  const [description, setDescription] = useState(existingIssue?.description ?? '');
  const [newComment, setNewComment] = useState('');
  const [comments, setComments] = useState<Comment[]>(existingIssue?.comments ?? []);

  const [focusedField, setFocusedField] = useState(0);
  const [editing, setEditing] = useState(false);

  const currentField = FIELDS[focusedField]!;
  const isSelectField = SELECT_FIELDS.includes(currentField);

  function save() {
    const parsedLabels = labels
      .split(',')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (selectedIssueId !== null) {
      backend.updateIssue(selectedIssueId, {
        title,
        status,
        iteration,
        priority: priority as 'low' | 'medium' | 'high' | 'critical',
        assignee,
        labels: parsedLabels,
        description,
      });

      if (newComment.trim().length > 0) {
        const added = backend.addComment(selectedIssueId, { author: 'me', body: newComment.trim() });
        setComments(prev => [...prev, added]);
        setNewComment('');
      }
    } else {
      const created = backend.createIssue({
        title: title || 'Untitled',
        status,
        iteration,
        priority: priority as 'low' | 'medium' | 'high' | 'critical',
        assignee,
        labels: parsedLabels,
        description,
      });

      if (newComment.trim().length > 0) {
        backend.addComment(created.id, { author: 'me', body: newComment.trim() });
      }
    }
  }

  useInput((_input, key) => {
    if (!editing) {
      if (key.upArrow) {
        setFocusedField(f => Math.max(0, f - 1));
      }

      if (key.downArrow) {
        setFocusedField(f => Math.min(FIELDS.length - 1, f + 1));
      }

      if (key.return) {
        setEditing(true);
      }

      if (key.escape) {
        save();
        navigate('list');
      }
    } else {
      // Editing a text field — Esc confirms the edit
      if (key.escape) {
        setEditing(false);
      }
    }
  }, { isActive: !editing || !isSelectField });

  function getSelectItems(field: FieldName) {
    switch (field) {
      case 'status': {
        return statuses.map(s => ({ label: s, value: s }));
      }

      case 'iteration': {
        return iterations.map(i => ({ label: i, value: i }));
      }

      case 'priority': {
        return PRIORITIES.map(p => ({ label: p, value: p }));
      }

      default: {
        return [];
      }
    }
  }

  function getSelectInitialIndex(field: FieldName): number {
    switch (field) {
      case 'status': {
        const idx = statuses.indexOf(status);
        return idx >= 0 ? idx : 0;
      }

      case 'iteration': {
        const idx = iterations.indexOf(iteration);
        return idx >= 0 ? idx : 0;
      }

      case 'priority': {
        const idx = PRIORITIES.indexOf(priority);
        return idx >= 0 ? idx : 0;
      }

      default: {
        return 0;
      }
    }
  }

  function handleSelectItem(field: FieldName, value: string) {
    switch (field) {
      case 'status': {
        setStatus(value);
        break;
      }

      case 'iteration': {
        setIteration(value);
        break;
      }

      case 'priority': {
        setPriority(value as 'low' | 'medium' | 'high' | 'critical');
        break;
      }

      default: {
        break;
      }
    }

    setEditing(false);
  }

  function renderField(field: FieldName, index: number) {
    const focused = index === focusedField;
    const isEditing = focused && editing;
    const label = field.charAt(0).toUpperCase() + field.slice(1);
    const cursor = focused ? '>' : ' ';

    if (field === 'comments') {
      return (
        <Box key={field} flexDirection="column">
          <Box>
            <Text color={focused ? 'cyan' : undefined}>{cursor} </Text>
            <Text bold={focused} color={focused ? 'cyan' : undefined}>{label}:</Text>
          </Box>
          {comments.map((c, ci) => (
            <Box key={ci} marginLeft={4}>
              <Text dimColor>[{c.date}] {c.author}: {c.body}</Text>
            </Box>
          ))}
          <Box marginLeft={4}>
            {isEditing ? (
              <Box>
                <Text color="green">New: </Text>
                <TextInput
                  value={newComment}
                  onChange={setNewComment}
                  focus={true}
                  onSubmit={() => {
                    setEditing(false);
                  }}
                />
              </Box>
            ) : (
              <Text dimColor>{newComment ? `New: ${newComment}` : '(press Enter to add comment)'}</Text>
            )}
          </Box>
        </Box>
      );
    }

    if (SELECT_FIELDS.includes(field)) {
      const currentValue = field === 'status' ? status : field === 'iteration' ? iteration : priority;

      if (isEditing) {
        return (
          <Box key={field} flexDirection="column">
            <Box>
              <Text color="cyan">{cursor} </Text>
              <Text bold color="cyan">{label}: </Text>
            </Box>
            <Box marginLeft={4}>
              <SelectInput
                items={getSelectItems(field)}
                initialIndex={getSelectInitialIndex(field)}
                onSelect={(item) => {
                  handleSelectItem(field, item.value);
                }}
              />
            </Box>
          </Box>
        );
      }

      return (
        <Box key={field}>
          <Text color={focused ? 'cyan' : undefined}>{cursor} </Text>
          <Text bold={focused} color={focused ? 'cyan' : undefined}>{label}: </Text>
          <Text>{currentValue}</Text>
        </Box>
      );
    }

    // Text fields: title, assignee, labels, description
    const textValue = field === 'title' ? title
      : field === 'assignee' ? assignee
        : field === 'labels' ? labels
          : description;

    const textSetter = field === 'title' ? setTitle
      : field === 'assignee' ? setAssignee
        : field === 'labels' ? setLabels
          : setDescription;

    if (isEditing) {
      return (
        <Box key={field}>
          <Text color="cyan">{cursor} </Text>
          <Text bold color="cyan">{label}: </Text>
          <TextInput
            value={textValue}
            onChange={textSetter}
            focus={true}
            onSubmit={() => {
              setEditing(false);
            }}
          />
        </Box>
      );
    }

    return (
      <Box key={field}>
        <Text color={focused ? 'cyan' : undefined}>{cursor} </Text>
        <Text bold={focused} color={focused ? 'cyan' : undefined}>{label}: </Text>
        <Text>{textValue || <Text dimColor>(empty)</Text>}</Text>
      </Box>
    );
  }

  const mode = selectedIssueId !== null ? 'Edit' : 'Create';

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">{mode} Issue{selectedIssueId !== null ? ` #${selectedIssueId}` : ''}</Text>
      </Box>

      {FIELDS.map((field, index) => renderField(field, index))}

      <Box marginTop={1}>
        <Text dimColor>
          {editing
            ? isSelectField
              ? 'up/down: navigate  enter: select'
              : 'type to edit  enter/esc: confirm'
            : 'up/down: navigate  enter: edit field  esc: save & back'}
        </Text>
      </Box>
    </Box>
  );
}
