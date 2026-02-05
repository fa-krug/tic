import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useAppState } from '../app.js';
import { readConfig, writeConfig } from '../backends/local/config.js';
import type { Config } from '../backends/local/config.js';
import { VALID_BACKENDS } from '../backends/factory.js';
import type { BackendType } from '../backends/factory.js';
import { checkAllBackendAvailability } from '../backends/availability.js';
import { SyncQueueStore } from '../sync/queue.js';
import type { Template } from '../types.js';
import { checkForUpdate } from '../update-checker.js';
import type { UpdateInfo } from '../update-checker.js';
import { VERSION } from '../version.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

type NavItem =
  | { kind: 'backend'; backend: string }
  | { kind: 'jira-field'; field: 'site' | 'project' | 'boardId' }
  | { kind: 'template-header' }
  | { kind: 'template'; slug: string; name: string }
  | { kind: 'updates-header' }
  | { kind: 'update-now' }
  | { kind: 'update-check' }
  | { kind: 'update-toggle' };

const JIRA_FIELDS = ['site', 'project', 'boardId'] as const;

type AvailabilityStatus = 'checking' | 'available' | 'unavailable';

export function Settings() {
  const {
    navigate,
    navigateToHelp,
    backend,
    syncManager,
    setFormMode,
    setEditingTemplateSlug,
    selectWorkItem,
  } = useAppState();
  const root = process.cwd();

  const queueStore = useMemo(() => {
    if (!syncManager) return null;
    return new SyncQueueStore(root);
  }, [syncManager, root]);

  const [config, setConfig] = useState<Config | null>(null);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [jiraSite, setJiraSite] = useState('');
  const [jiraProject, setJiraProject] = useState('');
  const [jiraBoardId, setJiraBoardId] = useState('');

  const [templates, setTemplates] = useState<Template[]>([]);
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);

  const [availability, setAvailability] = useState<
    Record<BackendType, AvailabilityStatus>
  >({
    local: 'available',
    github: 'checking',
    gitlab: 'checking',
    azure: 'checking',
    jira: 'available',
  });

  const capabilities = backend.getCapabilities();

  useEffect(() => {
    void readConfig(root).then(setConfig);
  }, [root]);

  useEffect(() => {
    void checkAllBackendAvailability().then((results) => {
      setAvailability(
        Object.fromEntries(
          Object.entries(results).map(([b, ok]) => [
            b,
            ok ? 'available' : 'unavailable',
          ]),
        ) as Record<BackendType, AvailabilityStatus>,
      );
    });
  }, []);

  useEffect(() => {
    if (capabilities.templates) {
      void backend.listTemplates().then(setTemplates);
    }
  }, [backend, capabilities.templates]);

  useEffect(() => {
    setUpdateChecking(true);
    void checkForUpdate().then((info) => {
      setUpdateInfo(info);
      setUpdateChecking(false);
    });
  }, []);

  // Initialize cursor and jira fields when config loads
  useEffect(() => {
    if (config) {
      setCursor(
        Math.max(
          0,
          VALID_BACKENDS.indexOf(
            config.backend as (typeof VALID_BACKENDS)[number],
          ),
        ),
      );
      if (config.jira) {
        setJiraSite(config.jira.site ?? '');
        setJiraProject(config.jira.project ?? '');
        setJiraBoardId(
          config.jira.boardId != null ? String(config.jira.boardId) : '',
        );
      }
    }
  }, [config]);

  // Build navigable items list — backends + conditional jira fields + templates
  const navItems: NavItem[] = useMemo(() => {
    const items: NavItem[] = VALID_BACKENDS.map((b) => ({
      kind: 'backend' as const,
      backend: b,
    }));
    if (config?.backend === 'jira') {
      const jiraIdx = items.findIndex(
        (i) => i.kind === 'backend' && i.backend === 'jira',
      );
      if (jiraIdx >= 0) {
        items.splice(
          jiraIdx + 1,
          0,
          ...JIRA_FIELDS.map(
            (field) => ({ kind: 'jira-field' as const, field }) as NavItem,
          ),
        );
      }
    }
    if (capabilities.templates) {
      items.push({ kind: 'template-header' });
      for (const t of templates) {
        items.push({ kind: 'template', slug: t.slug, name: t.name });
      }
    }
    items.push({ kind: 'updates-header' });
    if (updateInfo?.updateAvailable) {
      items.push({ kind: 'update-now' });
    }
    items.push({ kind: 'update-check' });
    items.push({ kind: 'update-toggle' });
    return items;
  }, [config?.backend, capabilities.templates, templates, updateInfo]);

  // Clamp cursor when navItems shrinks (e.g. switching away from jira)
  useEffect(() => {
    setCursor((c) => Math.min(c, navItems.length - 1));
  }, [navItems.length]);

  function saveJiraConfig() {
    if (!config) return;
    const boardIdNum = parseInt(jiraBoardId.trim(), 10);
    config.jira = {
      site: jiraSite.trim(),
      project: jiraProject.trim(),
      ...(jiraBoardId.trim() && !isNaN(boardIdNum)
        ? { boardId: boardIdNum }
        : {}),
    };
    void writeConfig(root, config);
  }

  // Navigation mode input handler
  useInput(
    (input, key) => {
      if (!config) return;

      if (confirmDeleteTemplate) {
        if (input === 'y' || input === 'Y') {
          if (templateToDelete) {
            void backend.deleteTemplate(templateToDelete).then(async () => {
              setTemplates((prev) =>
                prev.filter((t) => t.slug !== templateToDelete),
              );
              if (queueStore) {
                await queueStore.append({
                  action: 'template-delete',
                  itemId: templateToDelete,
                  timestamp: new Date().toISOString(),
                  templateSlug: templateToDelete,
                });
                syncManager?.pushPending().catch(() => {});
              }
            });
          }
          setConfirmDeleteTemplate(false);
          setTemplateToDelete(null);
        } else {
          setConfirmDeleteTemplate(false);
          setTemplateToDelete(null);
        }
        return;
      }

      if (input === '?') {
        navigateToHelp();
        return;
      }

      if (key.escape || input === ',') {
        navigate('list');
        return;
      }

      if (key.upArrow) {
        setCursor((c) => {
          let next = c - 1;
          while (
            next >= 0 &&
            (navItems[next]?.kind === 'template-header' ||
              navItems[next]?.kind === 'updates-header')
          ) {
            next--;
          }
          return Math.max(0, next);
        });
      }
      if (key.downArrow) {
        setCursor((c) => {
          let next = c + 1;
          while (
            next < navItems.length &&
            (navItems[next]?.kind === 'template-header' ||
              navItems[next]?.kind === 'updates-header')
          ) {
            next++;
          }
          return Math.min(navItems.length - 1, next);
        });
      }

      if (key.return) {
        const item = navItems[cursor]!;
        if (item.kind === 'backend') {
          if (availability[item.backend as BackendType] !== 'available') return;
          config.backend = item.backend;
          if (item.backend === 'jira' && !config.jira) {
            config.jira = { site: jiraSite, project: jiraProject };
          }
          void writeConfig(root, config);
          setConfig({ ...config });
          // Auto-advance cursor to first jira field
          if (item.backend === 'jira') {
            const jiraIdx = VALID_BACKENDS.indexOf('jira');
            setCursor(jiraIdx + 1);
          }
        } else if (item.kind === 'jira-field') {
          setEditing(true);
        } else if (item.kind === 'template') {
          setFormMode('template');
          setEditingTemplateSlug(item.slug);
          selectWorkItem(null);
          navigate('form');
        } else if (item.kind === 'update-check') {
          setUpdateChecking(true);
          void checkForUpdate().then((info) => {
            setUpdateInfo(info);
            setUpdateChecking(false);
          });
        } else if (item.kind === 'update-now') {
          const __filename = fileURLToPath(import.meta.url);
          const updaterPath = path.join(
            path.dirname(__filename),
            '..',
            'updater.js',
          );
          const originalArgs = process.argv.slice(2);
          spawn('node', [updaterPath, ...originalArgs], {
            stdio: 'inherit',
            detached: true,
          });
          process.exit(0);
        } else if (item.kind === 'update-toggle') {
          if (config) {
            config.autoUpdate = !(config.autoUpdate !== false);
            void writeConfig(root, config);
            setConfig({ ...config });
          }
        }
      }

      if (input === 'c' && capabilities.templates) {
        setFormMode('template');
        setEditingTemplateSlug(null);
        selectWorkItem(null);
        navigate('form');
      }

      if (input === 'd') {
        const item = navItems[cursor];
        if (item && item.kind === 'template') {
          setTemplateToDelete(item.slug);
          setConfirmDeleteTemplate(true);
        }
      }
    },
    { isActive: !editing },
  );

  // Edit mode input handler — only captures Esc to exit editing
  useInput(
    (_input, key) => {
      if (key.escape) {
        setEditing(false);
        saveJiraConfig();
      }
    },
    { isActive: editing },
  );

  if (!config) {
    return (
      <Box>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Settings
        </Text>
      </Box>

      <Text bold>Backend:</Text>
      {navItems.map((item, idx) => {
        const focused = idx === cursor;

        if (item.kind === 'backend') {
          const b = item.backend as BackendType;
          const isCurrent = b === config.backend;
          const status = availability[b];
          return (
            <Box key={b}>
              <Text color={focused ? 'cyan' : undefined}>
                {focused ? '>' : ' '}{' '}
              </Text>
              <Text
                color={focused ? 'cyan' : undefined}
                bold={focused}
                dimColor={status !== 'available'}
              >
                {b}
                {isCurrent ? ' (current)' : ''}
                {status === 'checking' ? ' (checking...)' : ''}
                {status === 'unavailable' ? ' (not available)' : ''}
              </Text>
            </Box>
          );
        }

        if (
          item.kind === 'template-header' ||
          item.kind === 'template' ||
          item.kind === 'updates-header' ||
          item.kind === 'update-now' ||
          item.kind === 'update-check' ||
          item.kind === 'update-toggle'
        ) {
          return null; // rendered separately below
        }

        // Jira config field
        const { field } = item;
        const label =
          field === 'boardId'
            ? 'Board ID'
            : field === 'site'
              ? 'Site'
              : 'Project';
        const value =
          field === 'site'
            ? jiraSite
            : field === 'project'
              ? jiraProject
              : jiraBoardId;
        const setter =
          field === 'site'
            ? setJiraSite
            : field === 'project'
              ? setJiraProject
              : setJiraBoardId;
        const required = field !== 'boardId';
        const isEditing = focused && editing;

        return (
          <Box key={`jira-${field}`} marginLeft={4}>
            <Text color={focused ? 'cyan' : undefined}>
              {focused ? '>' : ' '}{' '}
            </Text>
            {isEditing ? (
              <Box>
                <Text bold color="cyan">
                  {label}:{' '}
                </Text>
                <TextInput
                  value={value}
                  onChange={setter}
                  focus={true}
                  onSubmit={() => {
                    setEditing(false);
                    saveJiraConfig();
                  }}
                />
              </Box>
            ) : (
              <Text bold={focused} color={focused ? 'cyan' : undefined}>
                {label}:{' '}
                {value || (
                  <Text dimColor>{required ? '(required)' : '(optional)'}</Text>
                )}
              </Text>
            )}
          </Box>
        );
      })}

      <Box marginTop={1} flexDirection="column">
        <Text bold>Project Config:</Text>
        <Box marginLeft={2}>
          <Text dimColor>Types: {config.types.join(', ')}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>Statuses: {config.statuses.join(', ')}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>Iterations: {config.iterations.join(', ')}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>Current iteration: {config.current_iteration}</Text>
        </Box>
      </Box>

      {capabilities.templates && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Templates:</Text>
          {navItems.map((item, idx) => {
            if (item.kind !== 'template') return null;
            const focused = idx === cursor;
            return (
              <Box key={`tmpl-${item.slug}`} marginLeft={2}>
                <Text color={focused ? 'cyan' : undefined}>
                  {focused ? '>' : ' '}{' '}
                </Text>
                <Text bold={focused} color={focused ? 'cyan' : undefined}>
                  {item.name}
                </Text>
              </Box>
            );
          })}
          {templates.length === 0 && (
            <Box marginLeft={2}>
              <Text dimColor>(no templates — press c to create)</Text>
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold>Updates:</Text>
        <Box marginLeft={2}>
          <Text dimColor>Current: v{VERSION}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>
            Latest:{' '}
            {updateChecking
              ? 'checking...'
              : updateInfo
                ? updateInfo.updateAvailable
                  ? `v${updateInfo.latest}`
                  : `v${updateInfo.latest} (up to date)`
                : 'unknown'}
          </Text>
        </Box>
        {navItems.map((item, idx) => {
          const focused = idx === cursor;

          if (item.kind === 'update-now') {
            return (
              <Box key="update-now" marginLeft={2}>
                <Text color={focused ? 'cyan' : undefined}>
                  {focused ? '>' : ' '}{' '}
                </Text>
                <Text bold={focused} color={focused ? 'cyan' : 'green'}>
                  Update to v{updateInfo?.latest}
                </Text>
              </Box>
            );
          }

          if (item.kind === 'update-check') {
            return (
              <Box key="update-check" marginLeft={2}>
                <Text color={focused ? 'cyan' : undefined}>
                  {focused ? '>' : ' '}{' '}
                </Text>
                <Text bold={focused} color={focused ? 'cyan' : undefined}>
                  {updateChecking ? 'Checking...' : 'Check for updates'}
                </Text>
              </Box>
            );
          }

          if (item.kind === 'update-toggle') {
            return (
              <Box key="update-toggle" marginLeft={2}>
                <Text color={focused ? 'cyan' : undefined}>
                  {focused ? '>' : ' '}{' '}
                </Text>
                <Text bold={focused} color={focused ? 'cyan' : undefined}>
                  Auto-check on launch:{' '}
                  {config?.autoUpdate !== false ? 'on' : 'off'}
                </Text>
              </Box>
            );
          }

          return null;
        })}
      </Box>

      {confirmDeleteTemplate && (
        <Box marginTop={1}>
          <Text color="red">
            Delete template &quot;
            {templates.find((t) => t.slug === templateToDelete)?.name ??
              templateToDelete}
            &quot;? (y/n)
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {capabilities.templates
            ? '↑↓ navigate  enter select  c create template  d delete template  esc back  ? help'
            : '↑↓ navigate  enter select  esc back  ? help'}
        </Text>
      </Box>
    </Box>
  );
}
