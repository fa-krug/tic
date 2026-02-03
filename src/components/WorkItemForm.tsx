import { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { AutocompleteInput } from './AutocompleteInput.js';
import { useAppState } from '../app.js';
import type { Comment, WorkItem } from '../types.js';
import { SyncQueueStore } from '../sync/queue.js';
import type { QueueAction } from '../sync/types.js';
import { useScrollViewport } from '../hooks/useScrollViewport.js';
import { useBackendData } from '../hooks/useBackendData.js';

type FieldName =
  | 'title'
  | 'type'
  | 'status'
  | 'iteration'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'description'
  | 'parent'
  | 'dependsOn'
  | 'comments'
  | `rel-parent`
  | `rel-child-${string}`
  | `rel-dependent-${string}`;

const SELECT_FIELDS: FieldName[] = ['type', 'status', 'iteration', 'priority'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

export function WorkItemForm() {
  const {
    backend,
    syncManager,
    navigate,
    navigateToHelp,
    selectedWorkItemId,
    activeType,
    pushWorkItem,
    popWorkItem,
  } = useAppState();

  const queueStore = useMemo(() => {
    if (!syncManager) return null;
    return new SyncQueueStore(process.cwd());
  }, [syncManager]);

  const queueWrite = async (
    action: QueueAction,
    itemId: string,
    commentData?: { author: string; body: string },
  ) => {
    if (queueStore) {
      await queueStore.append({
        action,
        itemId,
        timestamp: new Date().toISOString(),
        ...(commentData ? { commentData } : {}),
      });
      syncManager?.pushPending().catch(() => {});
    }
  };

  const {
    capabilities,
    statuses,
    iterations,
    types,
    assignees,
    currentIteration,
    items: allItems,
    loading: configLoading,
  } = useBackendData(backend);

  const [existingItem, setExistingItem] = useState<WorkItem | null>(null);
  const [children, setChildren] = useState<WorkItem[]>([]);
  const [dependents, setDependents] = useState<WorkItem[]>([]);
  const [parentItem, setParentItem] = useState<WorkItem | null>(null);
  const [itemLoading, setItemLoading] = useState(selectedWorkItemId !== null);

  useEffect(() => {
    if (selectedWorkItemId === null) {
      setExistingItem(null);
      setChildren([]);
      setDependents([]);
      setParentItem(null);
      setItemLoading(false);
      return;
    }
    let cancelled = false;
    setItemLoading(true);
    void (async () => {
      try {
        const item = await backend.getWorkItem(selectedWorkItemId);
        const [ch, dep] = capabilities.relationships
          ? await Promise.all([
              backend.getChildren(selectedWorkItemId),
              backend.getDependents(selectedWorkItemId),
            ])
          : [[], []];
        const pi = item.parent ? await backend.getWorkItem(item.parent) : null;
        if (cancelled) return;
        setExistingItem(item);
        setChildren(ch);
        setDependents(dep);
        setParentItem(pi);
      } catch {
        if (cancelled) return;
        setExistingItem(null);
        setChildren([]);
        setDependents([]);
        setParentItem(null);
      } finally {
        if (!cancelled) setItemLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWorkItemId, backend, capabilities.relationships]);

  const fields = useMemo(() => {
    const all: FieldName[] = ['title'];
    if (capabilities.customTypes) all.push('type');
    all.push('status');
    if (capabilities.iterations) all.push('iteration');
    if (capabilities.fields.priority) all.push('priority');
    if (capabilities.fields.assignee) all.push('assignee');
    if (capabilities.fields.labels) all.push('labels');
    all.push('description');
    if (capabilities.fields.parent) all.push('parent');
    if (capabilities.fields.dependsOn) all.push('dependsOn');
    if (capabilities.comments) all.push('comments');

    if (selectedWorkItemId !== null && capabilities.relationships) {
      if (existingItem?.parent) {
        all.push('rel-parent');
      }
      for (const child of children) {
        all.push(`rel-child-${child.id}`);
      }
      for (const dep of dependents) {
        all.push(`rel-dependent-${dep.id}`);
      }
    }

    return all;
  }, [capabilities, selectedWorkItemId, existingItem, children, dependents]);

  const [title, setTitle] = useState('');
  const [type, setType] = useState(activeType ?? types[0] ?? '');
  const [status, setStatus] = useState(statuses[0] ?? '');
  const [iteration, setIteration] = useState(currentIteration);
  const [priority, setPriority] = useState<
    'low' | 'medium' | 'high' | 'critical'
  >('medium');
  const [assignee, setAssignee] = useState('');
  const [labels, setLabels] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState('');
  const [dependsOn, setDependsOn] = useState('');
  const [newComment, setNewComment] = useState('');
  const [comments, setComments] = useState<Comment[]>([]);

  // Sync form fields when the existing item finishes loading
  useEffect(() => {
    if (!existingItem) return;
    setTitle(existingItem.title);
    setType(existingItem.type);
    setStatus(existingItem.status);
    setIteration(existingItem.iteration);
    setPriority(existingItem.priority ?? 'medium');
    setAssignee(existingItem.assignee ?? '');
    setLabels(existingItem.labels.join(', '));
    setDescription(existingItem.description ?? '');
    setParentId(
      existingItem.parent !== null && existingItem.parent !== undefined
        ? (() => {
            const pi = allItems.find((i) => i.id === existingItem.parent);
            return pi
              ? `#${existingItem.parent} - ${pi.title}`
              : String(existingItem.parent);
          })()
        : '',
    );
    setDependsOn(existingItem.dependsOn?.join(', ') ?? '');
    setComments(existingItem.comments ?? []);
  }, [existingItem]);

  const parentSuggestions = useMemo(() => {
    return allItems
      .filter((item) => item.id !== selectedWorkItemId)
      .map((item) => `#${item.id} - ${item.title}`);
  }, [allItems, selectedWorkItemId]);

  const [focusedField, setFocusedField] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFocusedField(0);
    setEditing(false);
  }, [selectedWorkItemId]);

  const currentField = fields[focusedField]!;
  const isSelectField = SELECT_FIELDS.includes(currentField);
  const isRelationshipField =
    currentField === 'rel-parent' ||
    currentField?.startsWith('rel-child-') ||
    currentField?.startsWith('rel-dependent-');

  async function save() {
    const parsedLabels = labels
      .split(',')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsedParent = (() => {
      const trimmed = parentId.trim();
      if (!trimmed) return null;
      const match = trimmed.match(/^#(\S+)\s*-\s/);
      return match ? match[1]! : trimmed;
    })();
    const parsedDependsOn = dependsOn
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (selectedWorkItemId !== null) {
      await backend.cachedUpdateWorkItem(selectedWorkItemId, {
        title,
        type,
        status,
        iteration,
        priority: priority,
        assignee,
        labels: parsedLabels,
        description,
        parent: parsedParent,
        dependsOn: parsedDependsOn,
      });
      await queueWrite('update', selectedWorkItemId);

      if (capabilities.comments && newComment.trim().length > 0) {
        const added = await backend.addComment(selectedWorkItemId, {
          author: 'me',
          body: newComment.trim(),
        });
        await queueWrite('comment', selectedWorkItemId, {
          author: 'me',
          body: newComment.trim(),
        });
        setComments((prev) => [...prev, added]);
        setNewComment('');
      }
    } else {
      const created = await backend.cachedCreateWorkItem({
        title: title || 'Untitled',
        type,
        status,
        iteration,
        priority: priority,
        assignee,
        labels: parsedLabels,
        description,
        parent: parsedParent,
        dependsOn: parsedDependsOn,
      });
      await queueWrite('create', created.id);

      if (capabilities.comments && newComment.trim().length > 0) {
        await backend.addComment(created.id, {
          author: 'me',
          body: newComment.trim(),
        });
        await queueWrite('comment', created.id, {
          author: 'me',
          body: newComment.trim(),
        });
      }
    }
  }

  useInput(
    (_input, key) => {
      if (configLoading || itemLoading || saving) return;
      if (!editing) {
        if (_input === '?') {
          navigateToHelp();
          return;
        }

        if (key.upArrow) {
          setFocusedField((f) => Math.max(0, f - 1));
        }

        if (key.downArrow) {
          setFocusedField((f) => Math.min(fields.length - 1, f + 1));
        }

        if (key.return) {
          if (isRelationshipField) {
            let targetId: string | null = null;
            if (currentField === 'rel-parent' && existingItem?.parent) {
              targetId = existingItem.parent;
            } else if (currentField.startsWith('rel-child-')) {
              targetId = currentField.slice('rel-child-'.length);
            } else if (currentField.startsWith('rel-dependent-')) {
              targetId = currentField.slice('rel-dependent-'.length);
            }
            if (targetId) {
              setSaving(true);
              void (async () => {
                await save();
                pushWorkItem(targetId);
              })();
            }
          } else {
            setEditing(true);
          }
        }

        if (key.escape) {
          void save();
          const prev = popWorkItem();
          if (prev === null) {
            navigate('list');
          }
        }
      } else {
        if (key.escape) {
          setEditing(false);
        }
      }
    },
    {
      isActive:
        !configLoading &&
        !itemLoading &&
        !saving &&
        (!editing ||
          (!isSelectField &&
            currentField !== 'assignee' &&
            currentField !== 'parent')),
    },
  );

  function getSelectItems(field: FieldName) {
    switch (field) {
      case 'type': {
        return types.map((t) => ({ label: t, value: t }));
      }

      case 'status': {
        return statuses.map((s) => ({ label: s, value: s }));
      }

      case 'iteration': {
        return iterations.map((i) => ({ label: i, value: i }));
      }

      case 'priority': {
        return PRIORITIES.map((p) => ({ label: p, value: p }));
      }

      default: {
        return [];
      }
    }
  }

  function getSelectInitialIndex(field: FieldName): number {
    switch (field) {
      case 'type': {
        const idx = types.indexOf(type);
        return idx >= 0 ? idx : 0;
      }

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
      case 'type': {
        setType(value);
        break;
      }

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
            <Text bold={focused} color={focused ? 'cyan' : undefined}>
              {label}:
            </Text>
          </Box>
          {comments.map((c, ci) => (
            <Box key={ci} marginLeft={4}>
              <Text dimColor>
                [{c.date}] {c.author}: {c.body}
              </Text>
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
              <Text dimColor>
                {newComment
                  ? `New: ${newComment}`
                  : '(press Enter to add comment)'}
              </Text>
            )}
          </Box>
        </Box>
      );
    }

    if (SELECT_FIELDS.includes(field)) {
      const currentValue =
        field === 'type'
          ? type
          : field === 'status'
            ? status
            : field === 'iteration'
              ? iteration
              : priority;

      if (isEditing) {
        return (
          <Box key={field} flexDirection="column">
            <Box>
              <Text color="cyan">{cursor} </Text>
              <Text bold color="cyan">
                {label}:{' '}
              </Text>
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
          <Text bold={focused} color={focused ? 'cyan' : undefined}>
            {label}:{' '}
          </Text>
          <Text>{currentValue}</Text>
        </Box>
      );
    }

    if (field === 'assignee') {
      if (isEditing) {
        return (
          <Box key={field} flexDirection="column">
            <Box>
              <Text color="cyan">{cursor} </Text>
              <Text bold color="cyan">
                {label}:{' '}
              </Text>
            </Box>
            <Box marginLeft={4}>
              <AutocompleteInput
                value={assignee}
                onChange={setAssignee}
                onSubmit={() => {
                  setEditing(false);
                }}
                suggestions={assignees}
                focus={true}
              />
            </Box>
          </Box>
        );
      }

      return (
        <Box key={field}>
          <Text color={focused ? 'cyan' : undefined}>{cursor} </Text>
          <Text bold={focused} color={focused ? 'cyan' : undefined}>
            {label}:{' '}
          </Text>
          <Text>{assignee || <Text dimColor>(empty)</Text>}</Text>
        </Box>
      );
    }

    if (field === 'parent') {
      if (isEditing) {
        return (
          <Box key={field} flexDirection="column">
            <Box>
              <Text color="cyan">{cursor} </Text>
              <Text bold color="cyan">
                {label}:{' '}
              </Text>
            </Box>
            <Box marginLeft={4}>
              <AutocompleteInput
                value={parentId}
                onChange={setParentId}
                onSubmit={() => {
                  setEditing(false);
                }}
                suggestions={parentSuggestions}
                focus={true}
              />
            </Box>
          </Box>
        );
      }

      return (
        <Box key={field}>
          <Text color={focused ? 'cyan' : undefined}>{cursor} </Text>
          <Text bold={focused} color={focused ? 'cyan' : undefined}>
            {label}:{' '}
          </Text>
          <Text>{parentId || <Text dimColor>(empty)</Text>}</Text>
        </Box>
      );
    }

    // Text fields: title, labels, description, dependsOn
    const textValue =
      field === 'title'
        ? title
        : field === 'labels'
          ? labels
          : field === 'dependsOn'
            ? dependsOn
            : description;

    const textSetter =
      field === 'title'
        ? setTitle
        : field === 'labels'
          ? setLabels
          : field === 'dependsOn'
            ? setDependsOn
            : setDescription;

    if (isEditing) {
      return (
        <Box key={field}>
          <Text color="cyan">{cursor} </Text>
          <Text bold color="cyan">
            {label}:{' '}
          </Text>
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
        <Text bold={focused} color={focused ? 'cyan' : undefined}>
          {label}:{' '}
        </Text>
        <Text>{textValue || <Text dimColor>(empty)</Text>}</Text>
      </Box>
    );
  }

  function renderRelationshipField(field: FieldName, index: number) {
    const focused = index === focusedField;
    const cursor = focused ? '>' : ' ';
    const id = field.startsWith('rel-child-')
      ? field.slice('rel-child-'.length)
      : field.startsWith('rel-dependent-')
        ? field.slice('rel-dependent-'.length)
        : null;

    let item: { id: string; title: string } | null = null;
    if (field === 'rel-parent' && parentItem) {
      item = { id: parentItem.id, title: parentItem.title };
    } else if (id) {
      const child = children.find((c) => c.id === id);
      const dep = dependents.find((d) => d.id === id);
      const relItem = child ?? dep;
      item = relItem ? { id: relItem.id, title: relItem.title } : null;
    }

    if (!item) return null;

    return (
      <Box key={field}>
        <Text color={focused ? 'cyan' : undefined}>{cursor} </Text>
        <Text bold={focused} color={focused ? 'cyan' : undefined}>
          #{item.id} ({item.title})
        </Text>
      </Box>
    );
  }

  const viewport = useScrollViewport({
    totalItems: fields.length,
    cursor: focusedField,
    chromeLines: 4, // title+margin (2) + help bar margin+text (2)
  });

  if (configLoading || itemLoading) {
    return (
      <Box>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  const mode = selectedWorkItemId !== null ? 'Edit' : 'Create';
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  const isFieldVisible = (index: number) =>
    index >= viewport.start && index < viewport.end;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {mode} {typeLabel}
          {selectedWorkItemId !== null ? ` #${selectedWorkItemId}` : ''}
        </Text>
      </Box>

      {fields.map((field, index) => {
        if (
          field === 'rel-parent' ||
          field.startsWith('rel-child-') ||
          field.startsWith('rel-dependent-')
        ) {
          return null;
        }
        if (!isFieldVisible(index)) return null;
        return renderField(field, index);
      })}

      {selectedWorkItemId !== null &&
        capabilities.relationships &&
        fields.some((f, i) => f.startsWith('rel-') && isFieldVisible(i)) && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold dimColor>
              Relationships:
            </Text>

            {existingItem?.parent &&
              fields.some(
                (f, i) => f === 'rel-parent' && isFieldVisible(i),
              ) && (
                <Box flexDirection="column">
                  <Box marginLeft={2}>
                    <Text dimColor>Parent:</Text>
                  </Box>
                  {fields.map((field, index) =>
                    field === 'rel-parent' && isFieldVisible(index) ? (
                      <Box key={field} marginLeft={2}>
                        {renderRelationshipField(field, index)}
                      </Box>
                    ) : null,
                  )}
                </Box>
              )}

            {fields.some(
              (f, i) => f.startsWith('rel-child-') && isFieldVisible(i),
            ) && (
              <Box flexDirection="column">
                <Box marginLeft={2}>
                  <Text dimColor>Children:</Text>
                </Box>
                {fields.map((field, index) =>
                  field.startsWith('rel-child-') && isFieldVisible(index) ? (
                    <Box key={field} marginLeft={2}>
                      {renderRelationshipField(field, index)}
                    </Box>
                  ) : null,
                )}
              </Box>
            )}

            {fields.some(
              (f, i) => f.startsWith('rel-dependent-') && isFieldVisible(i),
            ) && (
              <Box flexDirection="column">
                <Box marginLeft={2}>
                  <Text dimColor>Depended on by:</Text>
                </Box>
                {fields.map((field, index) =>
                  field.startsWith('rel-dependent-') &&
                  isFieldVisible(index) ? (
                    <Box key={field} marginLeft={2}>
                      {renderRelationshipField(field, index)}
                    </Box>
                  ) : null,
                )}
              </Box>
            )}
          </Box>
        )}

      <Box marginTop={1}>
        <Text dimColor>
          {'↑↓ navigate  enter edit field  esc save & back  ? help'}
        </Text>
      </Box>
    </Box>
  );
}
