import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useNavigationStore } from '../stores/navigationStore.js';
import {
  useBackendDataStore,
  defaultCapabilities,
} from '../stores/backendDataStore.js';
import { useConfigStore, configStore } from '../stores/configStore.js';
import { uiStore, useUIStore } from '../stores/uiStore.js';
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
import { DefaultPicker } from './DefaultPicker.js';

type NavItem =
  | { kind: 'backend'; backend: string }
  | { kind: 'jira-field'; field: 'site' | 'project' | 'boardId' }
  | { kind: 'default-type' }
  | { kind: 'default-iteration' }
  | { kind: 'template-header' }
  | { kind: 'template'; slug: string; name: string }
  | { kind: 'updates-header' }
  | { kind: 'update-now' }
  | { kind: 'update-check' }
  | { kind: 'update-toggle' };

const JIRA_FIELDS = ['site', 'project', 'boardId'] as const;

type AvailabilityStatus = 'checking' | 'available' | 'unavailable';

export function Settings() {
  const backend = useBackendDataStore((s) => s.backend);
  const syncManager = useBackendDataStore((s) => s.syncManager);
  const navigate = useNavigationStore((s) => s.navigate);
  const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
  const setFormMode = useNavigationStore((s) => s.setFormMode);
  const setEditingTemplateSlug = useNavigationStore(
    (s) => s.setEditingTemplateSlug,
  );
  const selectWorkItem = useNavigationStore((s) => s.selectWorkItem);
  const root = process.cwd();

  const queueStore = useMemo(() => {
    if (!syncManager) return null;
    return new SyncQueueStore(root);
  }, [syncManager, root]);

  const config = useConfigStore((s) => s.config);
  const configLoaded = useConfigStore((s) => s.loaded);

  const [cursor, setCursor] = useState(0);
  const [jiraSite, setJiraSite] = useState('');
  const [jiraProject, setJiraProject] = useState('');
  const [jiraBoardId, setJiraBoardId] = useState('');

  const [templates, setTemplates] = useState<Template[]>([]);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);

  const activeOverlay = useUIStore((s) => s.activeOverlay);
  const { openOverlay, closeOverlay } = uiStore.getState();

  const [availability, setAvailability] = useState<
    Record<BackendType, AvailabilityStatus>
  >({
    local: 'available',
    github: 'checking',
    gitlab: 'checking',
    azure: 'checking',
    jira: 'available',
  });

  const capabilities = useMemo(
    () => backend?.getCapabilities() ?? defaultCapabilities,
    [backend],
  );

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
    if (capabilities.templates && backend) {
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
    if (configLoaded) {
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
  }, [config, configLoaded]);

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
    items.push({ kind: 'default-type' });
    items.push({ kind: 'default-iteration' });
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
    if (!configLoaded) return;
    const boardIdNum = parseInt(jiraBoardId.trim(), 10);
    void configStore.getState().update({
      jira: {
        site: jiraSite.trim(),
        project: jiraProject.trim(),
        ...(jiraBoardId.trim() && !isNaN(boardIdNum)
          ? { boardId: boardIdNum }
          : {}),
      },
    });
  }

  // Delete template confirmation handler
  useInput(
    (input) => {
      if (activeOverlay?.type !== 'delete-template-confirm') return;
      if (input === 'y' || input === 'Y') {
        const slug = activeOverlay.templateSlug;
        if (!backend) return;
        void backend.deleteTemplate(slug).then(async () => {
          setTemplates((prev) => prev.filter((t) => t.slug !== slug));
          if (queueStore) {
            await queueStore.append({
              action: 'template-delete',
              itemId: slug,
              timestamp: new Date().toISOString(),
              templateSlug: slug,
            });
            syncManager?.pushPending().catch(() => {});
          }
        });
      }
      closeOverlay();
    },
    { isActive: activeOverlay?.type === 'delete-template-confirm' },
  );

  // Navigation mode input handler
  useInput(
    (input, key) => {
      if (!configLoaded) return;

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
          const updates: Partial<typeof config> = { backend: item.backend };
          if (item.backend === 'jira' && !config.jira) {
            updates.jira = { site: jiraSite, project: jiraProject };
          }
          void configStore.getState().update(updates);
          // Auto-advance cursor to first jira field
          if (item.backend === 'jira') {
            const jiraIdx = VALID_BACKENDS.indexOf('jira');
            setCursor(jiraIdx + 1);
          }
        } else if (item.kind === 'jira-field') {
          openOverlay({ type: 'settings-edit' });
        } else if (item.kind === 'template') {
          setFormMode('template');
          setEditingTemplateSlug(item.slug);
          selectWorkItem(null);
          navigate('form');
        } else if (item.kind === 'default-type') {
          openOverlay({ type: 'default-type-picker' });
        } else if (item.kind === 'default-iteration') {
          openOverlay({ type: 'default-iteration-picker' });
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
          void configStore
            .getState()
            .update({ autoUpdate: !(config.autoUpdate !== false) });
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
          openOverlay({
            type: 'delete-template-confirm',
            templateSlug: item.slug,
          });
        }
      }
    },
    { isActive: activeOverlay === null },
  );

  // Edit mode input handler — only captures Esc to exit editing
  useInput(
    (_input, key) => {
      if (key.escape) {
        closeOverlay();
        saveJiraConfig();
      }
    },
    { isActive: activeOverlay?.type === 'settings-edit' },
  );

  // Config is loaded before render, but guard just in case
  if (!configLoaded) {
    return null;
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
          item.kind === 'default-type' ||
          item.kind === 'default-iteration' ||
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
        const isEditing = focused && activeOverlay?.type === 'settings-edit';

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
                    closeOverlay();
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
        <Text bold>Defaults:</Text>
        {navItems.map((item, idx) => {
          if (item.kind !== 'default-type' && item.kind !== 'default-iteration')
            return null;
          const focused = idx === cursor;
          const label =
            item.kind === 'default-type' ? 'Default type' : 'Default iteration';
          const value =
            item.kind === 'default-type'
              ? (config.defaultType ?? config.types[0] ?? 'none')
              : config.current_iteration;
          return (
            <Box key={item.kind} marginLeft={2}>
              <Text color={focused ? 'cyan' : undefined}>
                {focused ? '>' : ' '}{' '}
              </Text>
              <Text bold={focused} color={focused ? 'cyan' : undefined}>
                {label}: {value}
              </Text>
            </Box>
          );
        })}
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

      {activeOverlay?.type === 'default-type-picker' && (
        <DefaultPicker
          title="Default Type"
          options={config.types}
          onSelect={(type) => {
            void configStore.getState().update({ defaultType: type });
            closeOverlay();
          }}
          onCancel={() => closeOverlay()}
        />
      )}

      {activeOverlay?.type === 'default-iteration-picker' && (
        <DefaultPicker
          title="Default Iteration"
          options={config.iterations}
          onSelect={(iteration) => {
            void configStore
              .getState()
              .update({ current_iteration: iteration });
            closeOverlay();
          }}
          onCancel={() => closeOverlay()}
        />
      )}

      {activeOverlay?.type === 'delete-template-confirm' && (
        <Box marginTop={1}>
          <Text color="red">
            Delete template &quot;
            {templates.find((t) => t.slug === activeOverlay.templateSlug)
              ?.name ?? activeOverlay.templateSlug}
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
