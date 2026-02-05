import { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { AutocompleteInput } from './AutocompleteInput.js';
import { MultiAutocompleteInput } from './MultiAutocompleteInput.js';
import { useAppState } from '../app.js';
import type { Comment, WorkItem, Template } from '../types.js';
import { SyncQueueStore } from '../sync/queue.js';
import type { QueueAction } from '../sync/types.js';
import { useScrollViewport } from '../hooks/useScrollViewport.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import { openInEditor } from '../editor.js';
import { slugifyTemplateName } from '../backends/local/templates.js';
import {
  createSnapshot,
  isSnapshotEqual,
  type FormSnapshot,
} from './formSnapshot.js';

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
    activeTemplate,
    setActiveTemplate,
    formMode,
    setFormMode,
    editingTemplateSlug,
    setEditingTemplateSlug,
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
    extra?: {
      commentData?: { author: string; body: string };
      templateSlug?: string;
    },
  ) => {
    if (queueStore) {
      await queueStore.append({
        action,
        itemId,
        timestamp: new Date().toISOString(),
        ...(extra?.commentData ? { commentData: extra.commentData } : {}),
        ...(extra?.templateSlug ? { templateSlug: extra.templateSlug } : {}),
      });
      syncManager?.pushPending().catch(() => {});
    }
  };

  const capabilities = useBackendDataStore((s) => s.capabilities);
  const statuses = useBackendDataStore((s) => s.statuses);
  const iterations = useBackendDataStore((s) => s.iterations);
  const types = useBackendDataStore((s) => s.types);
  const assignees = useBackendDataStore((s) => s.assignees);
  const labelSuggestions = useBackendDataStore((s) => s.labels);
  const currentIteration = useBackendDataStore((s) => s.currentIteration);
  const allItems = useBackendDataStore((s) => s.items);
  const configLoading = useBackendDataStore((s) => s.loading);

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
    if (formMode === 'template') {
      const tf = capabilities.templateFields;
      const all: FieldName[] = ['title'];
      if (tf.type) all.push('type');
      if (tf.status) all.push('status');
      if (tf.iteration) all.push('iteration');
      if (tf.priority) all.push('priority');
      if (tf.assignee) all.push('assignee');
      if (tf.labels) all.push('labels');
      if (tf.description) all.push('description');
      if (tf.parent) all.push('parent');
      if (tf.dependsOn) all.push('dependsOn');
      return all;
    }

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
  }, [
    formMode,
    capabilities,
    selectedWorkItemId,
    existingItem,
    children,
    dependents,
  ]);

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

  const [initialSnapshot, setInitialSnapshot] = useState<FormSnapshot | null>(
    null,
  );

  const currentValues = createSnapshot({
    title,
    type,
    status,
    iteration,
    priority,
    assignee,
    labels,
    description,
    parentId,
    dependsOn,
    newComment,
  });
  const isDirty =
    initialSnapshot !== null &&
    !isSnapshotEqual(initialSnapshot, currentValues);
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
    setDependsOn(
      existingItem.dependsOn
        ?.map((depId) => {
          const depItem = allItems.find((i) => i.id === depId);
          return depItem ? `#${depId} - ${depItem.title}` : depId;
        })
        .join(', ') ?? '',
    );
    setComments(existingItem.comments ?? []);
    setInitialSnapshot(
      createSnapshot({
        title: existingItem.title,
        type: existingItem.type,
        status: existingItem.status,
        iteration: existingItem.iteration,
        priority: existingItem.priority ?? 'medium',
        assignee: existingItem.assignee ?? '',
        labels: existingItem.labels.join(', '),
        description: existingItem.description ?? '',
        parentId:
          existingItem.parent !== null && existingItem.parent !== undefined
            ? (() => {
                const pi = allItems.find((i) => i.id === existingItem.parent);
                return pi
                  ? `#${existingItem.parent} - ${pi.title}`
                  : String(existingItem.parent);
              })()
            : '',
        dependsOn:
          existingItem.dependsOn
            ?.map((depId) => {
              const depItem = allItems.find((i) => i.id === depId);
              return depItem ? `#${depId} - ${depItem.title}` : depId;
            })
            .join(', ') ?? '',
        newComment: '',
      }),
    );
  }, [existingItem]);

  // Prefill from template (create mode only)
  useEffect(() => {
    if (selectedWorkItemId !== null || !activeTemplate) return;
    if (activeTemplate.type != null) setType(activeTemplate.type);
    if (activeTemplate.status != null) setStatus(activeTemplate.status);
    if (activeTemplate.priority != null) setPriority(activeTemplate.priority);
    if (activeTemplate.assignee != null) setAssignee(activeTemplate.assignee);
    if (activeTemplate.labels != null)
      setLabels(activeTemplate.labels.join(', '));
    if (activeTemplate.iteration != null)
      setIteration(activeTemplate.iteration);
    if (activeTemplate.description != null)
      setDescription(activeTemplate.description);
    if (activeTemplate.parent != null)
      setParentId(String(activeTemplate.parent));
    if (activeTemplate.dependsOn != null)
      setDependsOn(activeTemplate.dependsOn.join(', '));
  }, [activeTemplate, selectedWorkItemId]);

  // Capture initial snapshot for new items once config finishes loading
  useEffect(() => {
    if (
      selectedWorkItemId !== null ||
      configLoading ||
      initialSnapshot !== null
    )
      return;
    setInitialSnapshot(
      createSnapshot({
        title,
        type,
        status,
        iteration,
        priority,
        assignee,
        labels,
        description,
        parentId,
        dependsOn,
        newComment,
      }),
    );
  }, [selectedWorkItemId, configLoading]);

  // Load existing template for editing
  useEffect(() => {
    if (formMode !== 'template' || !editingTemplateSlug) return;
    let cancelled = false;
    void backend.getTemplate(editingTemplateSlug).then((t) => {
      if (cancelled) return;
      setTitle(t.name);
      if (t.type != null) setType(t.type);
      if (t.status != null) setStatus(t.status);
      if (t.priority != null) setPriority(t.priority);
      if (t.assignee != null) setAssignee(t.assignee);
      if (t.labels != null) setLabels(t.labels.join(', '));
      if (t.iteration != null) setIteration(t.iteration);
      if (t.description != null) setDescription(t.description);
      if (t.parent != null) setParentId(String(t.parent));
      if (t.dependsOn != null) setDependsOn(t.dependsOn.join(', '));
      setInitialSnapshot(
        createSnapshot({
          title: t.name,
          type: t.type ?? type,
          status: t.status ?? status,
          iteration: t.iteration ?? iteration,
          priority: t.priority ?? priority,
          assignee: t.assignee ?? assignee,
          labels: t.labels != null ? t.labels.join(', ') : labels,
          description: t.description ?? description,
          parentId: t.parent != null ? String(t.parent) : parentId,
          dependsOn: t.dependsOn != null ? t.dependsOn.join(', ') : dependsOn,
          newComment: '',
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [formMode, editingTemplateSlug, backend]);

  const parentSuggestions = useMemo(() => {
    return allItems
      .filter((item) => item.id !== selectedWorkItemId)
      .map((item) => `#${item.id} - ${item.title}`);
  }, [allItems, selectedWorkItemId]);

  const [focusedField, setFocusedField] = useState(0);
  const [editing, setEditing] = useState(false);
  const [preEditValue, setPreEditValue] = useState<string>('');
  const [showDirtyPrompt, setShowDirtyPrompt] = useState(false);
  const [pendingRelNav, setPendingRelNav] = useState<string | null>(null);
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
      .map((s) => {
        const trimmed = s.trim();
        if (!trimmed) return '';
        const match = trimmed.match(/^#(\S+)\s*-\s/);
        return match ? match[1]! : trimmed;
      })
      .filter((s) => s.length > 0);

    if (formMode === 'template') {
      const template: Template = {
        slug: editingTemplateSlug ?? slugifyTemplateName(title),
        name: title || 'Untitled Template',
      };
      if (type) template.type = type;
      if (status) template.status = status;
      if (priority !== 'medium') template.priority = priority;
      if (assignee) template.assignee = assignee;
      if (parsedLabels.length > 0) template.labels = parsedLabels;
      if (iteration) template.iteration = iteration;
      if (description) template.description = description;
      if (parsedParent) template.parent = parsedParent;
      if (parsedDependsOn.length > 0) template.dependsOn = parsedDependsOn;

      if (editingTemplateSlug) {
        await backend.updateTemplate(editingTemplateSlug, template);
        await queueWrite('template-update', template.slug, {
          templateSlug: template.slug,
        });
      } else {
        await backend.createTemplate(template);
        await queueWrite('template-create', template.slug, {
          templateSlug: template.slug,
        });
      }
      setFormMode('item');
      setEditingTemplateSlug(null);
      return;
    }

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
          commentData: { author: 'me', body: newComment.trim() },
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
          commentData: { author: 'me', body: newComment.trim() },
        });
      }
      setActiveTemplate(null);
    }

    setInitialSnapshot(
      createSnapshot({
        title,
        type,
        status,
        iteration,
        priority,
        assignee,
        labels,
        description,
        parentId,
        dependsOn,
        newComment: '',
      }),
    );
  }

  useInput(
    (_input, key) => {
      // Dirty prompt overlay — capture s/d/esc only
      if (showDirtyPrompt) {
        if (_input === 's' && (selectedWorkItemId !== null || title.trim())) {
          void (async () => {
            await save();
            if (pendingRelNav) {
              pushWorkItem(pendingRelNav);
              setPendingRelNav(null);
            } else if (formMode === 'template') {
              setFormMode('item');
              setEditingTemplateSlug(null);
              navigate('settings');
            } else {
              const prev = popWorkItem();
              if (prev === null) navigate('list');
            }
          })();
          setShowDirtyPrompt(false);
          return;
        }
        if (_input === 'd') {
          // Discard: navigate back without saving
          if (pendingRelNav) {
            pushWorkItem(pendingRelNav);
            setPendingRelNav(null);
          } else if (formMode === 'template') {
            setFormMode('item');
            setEditingTemplateSlug(null);
            navigate('settings');
          } else {
            const prev = popWorkItem();
            if (prev === null) navigate('list');
          }
          setShowDirtyPrompt(false);
          return;
        }
        if (key.escape) {
          setShowDirtyPrompt(false);
          setPendingRelNav(null);
          return;
        }
        // Ignore all other keys while prompt is showing
        return;
      }

      // Esc in navigation mode
      if (key.escape && !editing) {
        if (configLoading || itemLoading || saving) {
          // Allow escape even while loading (no save)
          if (formMode === 'template') {
            setFormMode('item');
            setEditingTemplateSlug(null);
            navigate('settings');
          } else {
            const prev = popWorkItem();
            if (prev === null) navigate('list');
          }
          return;
        }
        if (isDirty) {
          setShowDirtyPrompt(true);
          return;
        }
        // Clean — just go back
        if (formMode === 'template') {
          setFormMode('item');
          setEditingTemplateSlug(null);
          navigate('settings');
        } else {
          const prev = popWorkItem();
          if (prev === null) navigate('list');
        }
        return;
      }

      if (configLoading || itemLoading || saving) return;
      if (!editing) {
        if (_input === '?') {
          navigateToHelp();
          return;
        }

        // Ctrl+S: save and go back
        if (key.ctrl && _input === 's') {
          setSaving(true);
          void (async () => {
            await save();
            if (formMode === 'template') {
              setFormMode('item');
              setEditingTemplateSlug(null);
              navigate('settings');
            } else {
              const prev = popWorkItem();
              if (prev === null) navigate('list');
            }
          })();
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
              if (isDirty) {
                setPendingRelNav(targetId);
                setShowDirtyPrompt(true);
              } else {
                pushWorkItem(targetId);
              }
            }
          } else if (currentField === 'description') {
            // Open external editor for description
            try {
              const edited = openInEditor(description);
              setDescription(edited);
            } catch {
              // Editor failed, fall back to inline editing
              setEditing(true);
            }
          } else {
            // Capture current value before editing for revert on Esc
            const fieldValue = (() => {
              switch (currentField) {
                case 'title':
                  return title;
                case 'assignee':
                  return assignee;
                case 'labels':
                  return labels;
                case 'parent':
                  return parentId;
                case 'dependsOn':
                  return dependsOn;
                case 'comments':
                  return newComment;
                default:
                  return '';
              }
            })();
            setPreEditValue(fieldValue);
            setEditing(true);
          }
        }
      } else {
        if (key.escape) {
          // Revert field to value before editing started
          switch (currentField) {
            case 'title':
              setTitle(preEditValue);
              break;
            case 'assignee':
              setAssignee(preEditValue);
              break;
            case 'labels':
              setLabels(preEditValue);
              break;
            case 'parent':
              setParentId(preEditValue);
              break;
            case 'dependsOn':
              setDependsOn(preEditValue);
              break;
            case 'comments':
              setNewComment(preEditValue);
              break;
            // Select fields (type, status, iteration, priority) already
            // require Enter to confirm, so Esc naturally discards
          }
          setEditing(false);
        }
      }
    },
    {
      isActive:
        !saving &&
        (!editing ||
          (!isSelectField &&
            currentField !== 'assignee' &&
            currentField !== 'labels' &&
            currentField !== 'parent' &&
            currentField !== 'dependsOn')),
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
    const label =
      formMode === 'template' && field === 'title'
        ? 'Name'
        : field.charAt(0).toUpperCase() + field.slice(1);
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

    // Description field - opens external editor
    if (field === 'description') {
      const lines = description.split('\n');
      const preview =
        lines.length > 1
          ? `${lines[0]}... (${lines.length} lines)`
          : description || '';

      return (
        <Box key={field} flexDirection="column">
          <Box>
            <Text color={focused ? 'cyan' : undefined}>{cursor} </Text>
            <Text bold={focused} color={focused ? 'cyan' : undefined}>
              {label}:{' '}
            </Text>
            <Text>
              {preview || <Text dimColor>(empty)</Text>}
              {focused && <Text dimColor> [enter opens $EDITOR]</Text>}
            </Text>
          </Box>
        </Box>
      );
    }

    if (field === 'dependsOn') {
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
                value={dependsOn}
                onChange={setDependsOn}
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
          <Text>{dependsOn || <Text dimColor>(empty)</Text>}</Text>
        </Box>
      );
    }

    if (field === 'labels') {
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
              <MultiAutocompleteInput
                value={labels}
                onChange={setLabels}
                onSubmit={() => {
                  setEditing(false);
                }}
                suggestions={labelSuggestions}
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
          <Text>{labels || <Text dimColor>(empty)</Text>}</Text>
        </Box>
      );
    }

    // Text fields: title
    const textValue = title;

    const textSetter = setTitle;

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

  const mode =
    formMode === 'template'
      ? editingTemplateSlug
        ? 'Edit Template'
        : 'Create Template'
      : selectedWorkItemId !== null
        ? 'Edit'
        : 'Create';
  const typeLabel =
    formMode === 'template' ? '' : type.charAt(0).toUpperCase() + type.slice(1);

  const isFieldVisible = (index: number) =>
    index >= viewport.start && index < viewport.end;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {mode}
          {typeLabel ? ` ${typeLabel}` : ''}
          {formMode !== 'template' && selectedWorkItemId !== null
            ? ` #${selectedWorkItemId}`
            : ''}
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
        {showDirtyPrompt ? (
          <Text>
            {selectedWorkItemId !== null || title.trim() ? (
              <Text>
                Unsaved changes:{' '}
                <Text color="green" bold>
                  (s)
                </Text>
                <Text>ave </Text>
                <Text color="red" bold>
                  (d)
                </Text>
                <Text>iscard </Text>
                <Text color="yellow" bold>
                  (esc)
                </Text>
                <Text> stay</Text>
              </Text>
            ) : (
              <Text>
                Discard new item?{' '}
                <Text color="red" bold>
                  (d)
                </Text>
                <Text>iscard </Text>
                <Text color="yellow" bold>
                  (esc)
                </Text>
                <Text> stay</Text>
              </Text>
            )}
          </Text>
        ) : (
          <Text dimColor>
            {editing
              ? 'enter confirm  esc revert  ? help'
              : isDirty
                ? '↑↓ navigate  enter edit  ctrl+s save & back  esc back (unsaved changes)  ? help'
                : '↑↓ navigate  enter edit  ctrl+s save & back  esc back  ? help'}
          </Text>
        )}
      </Box>
    </Box>
  );
}
