import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { useNavigationStore } from '../stores/navigationStore.js';
import {
  backendDataStore,
  useBackendDataStore,
  defaultCapabilities,
} from '../stores/backendDataStore.js';
import { useConfigStore, configStore } from '../stores/configStore.js';
import { uiStore, useUIStore } from '../stores/uiStore.js';
import { VALID_BACKENDS } from '../backends/factory.js';
import type { BackendType } from '../backends/factory.js';
import { checkAllBackendAvailability } from '../backends/availability.js';
import type { Template } from '../types.js';
import { checkForUpdate } from '../update-checker.js';
import type { UpdateInfo } from '../update-checker.js';
import { VERSION } from '../version.js';
import { requestUpdate } from '../updater.js';
import { OverlayPanel } from './OverlayPanel.js';
import { openInEditor } from '../editor.js';
import { matchesCommand } from '../commands.js';
import { defaultConfig } from '../storage/config.js';
import { useTerminalWidth } from '../hooks/useTerminalWidth.js';
import {
  themeStore,
  useThemeStore,
  themes,
  autoFg,
} from '../stores/themeStore.js';
import type { FieldType } from '../stores/themeStore.js';

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
  | { kind: 'update-toggle' }
  | { kind: 'branch-command' }
  | { kind: 'branch-clipboard-toggle' }
  | { kind: 'theme' }
  | { kind: 'color-status' }
  | { kind: 'color-priority' }
  | { kind: 'color-type' }
  | { kind: 'color-label' };

const JIRA_FIELDS = ['site', 'project', 'boardId'] as const;

type AvailabilityStatus = 'checking' | 'available' | 'unavailable';

export function Settings() {
  const { exit } = useApp();
  const backend = useBackendDataStore((s) => s.backend);
  const syncManager = useBackendDataStore((s) => s.syncManager);
  const navigate = useNavigationStore((s) => s.navigate);
  const settingsInitialFocus = useNavigationStore(
    (s) => s.settingsInitialFocus,
  );
  const setSettingsInitialFocus = useNavigationStore(
    (s) => s.setSettingsInitialFocus,
  );
  const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
  const setFormMode = useNavigationStore((s) => s.setFormMode);
  const setEditingTemplateSlug = useNavigationStore(
    (s) => s.setEditingTemplateSlug,
  );
  const selectWorkItem = useNavigationStore((s) => s.selectWorkItem);
  const terminalWidth = useTerminalWidth();
  const themeName = useThemeStore((s) => s.themeName);
  const { accent, success, mutedDim } = useThemeStore((s) => s.colors);

  const queue = useBackendDataStore((s) => s.queue);
  const storeLabels = useBackendDataStore((s) => s.labels);

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
    none: 'available',
    filesystem: 'available',
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
    let cancelled = false;
    void checkAllBackendAvailability()
      .then((results) => {
        if (cancelled) return;
        setAvailability(
          Object.fromEntries(
            Object.entries(results).map(([b, ok]) => [
              b,
              ok ? 'available' : 'unavailable',
            ]),
          ) as Record<BackendType, AvailabilityStatus>,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!capabilities.templates || !backend) return;
    let cancelled = false;
    void backend
      .listTemplates()
      .then((t) => {
        if (!cancelled) setTemplates(t);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        uiStore
          .getState()
          .setToast(
            err instanceof Error ? err.message : 'Failed to load templates',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [backend, capabilities.templates]);

  useEffect(() => {
    let cancelled = false;
    setUpdateChecking(true);
    void checkForUpdate()
      .then((info) => {
        if (cancelled) return;
        setUpdateInfo(info);
        setUpdateChecking(false);
      })
      .catch(() => {
        if (!cancelled) setUpdateChecking(false);
      });
    return () => {
      cancelled = true;
    };
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
    items.push({ kind: 'branch-command' });
    items.push({ kind: 'branch-clipboard-toggle' });
    items.push({ kind: 'theme' });
    items.push({ kind: 'color-status' as const });
    items.push({ kind: 'color-priority' as const });
    items.push({ kind: 'color-type' as const });
    items.push({ kind: 'color-label' as const });
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

  // Jump cursor to initial focus target (e.g. 'update-now' from update banner)
  useEffect(() => {
    if (settingsInitialFocus) {
      const idx = navItems.findIndex(
        (item) => item.kind === settingsInitialFocus,
      );
      if (idx >= 0) {
        setCursor(idx);
      }
      setSettingsInitialFocus(null);
    }
  }, [settingsInitialFocus, navItems, setSettingsInitialFocus]);

  function saveJiraConfig() {
    if (!configLoaded) return;
    const boardIdNum = parseInt(jiraBoardId.trim(), 10);
    void configStore
      .getState()
      .update({
        jira: {
          site: jiraSite.trim(),
          project: jiraProject.trim(),
          ...(jiraBoardId.trim() && !isNaN(boardIdNum)
            ? { boardId: boardIdNum }
            : {}),
        },
      })
      .catch(() => {});
  }

  // Navigation mode input handler
  useInput(
    (input, key) => {
      if (!configLoaded) return;

      if (matchesCommand('help', input, key)) {
        navigateToHelp();
        return;
      }

      if (matchesCommand('settings-back', input, key)) {
        navigate('list');
        return;
      }

      if (matchesCommand('settings-navigate', input, key)) {
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
        } else {
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
        return;
      }

      if (matchesCommand('settings-select', input, key)) {
        const item = navItems[cursor]!;
        if (item.kind === 'backend') {
          if (availability[item.backend as BackendType] !== 'available') return;
          const updates: Partial<typeof config> = { backend: item.backend };
          if (item.backend === 'jira' && !config.jira) {
            updates.jira = { site: jiraSite, project: jiraProject };
          }
          void configStore
            .getState()
            .update(updates)
            .catch(() => {});
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
          void checkForUpdate()
            .then((info) => {
              setUpdateInfo(info);
              setUpdateChecking(false);
            })
            .catch(() => {
              setUpdateChecking(false);
            });
        } else if (item.kind === 'update-now') {
          requestUpdate();
          exit();
        } else if (item.kind === 'update-toggle') {
          void configStore
            .getState()
            .update({ autoUpdate: !(config.autoUpdate !== false) })
            .catch(() => {});
        } else if (item.kind === 'branch-command') {
          try {
            const current =
              config?.branchCommand ?? defaultConfig.branchCommand ?? '';
            process.stdin.setRawMode?.(false);
            const edited = openInEditor(current);
            process.stdin.setRawMode?.(true);
            console.clear();
            void configStore
              .getState()
              .update({ branchCommand: edited.trim() })
              .catch(() => {});
          } catch {
            process.stdin.setRawMode?.(true);
            console.clear();
            // Editor failed, ignore
          }
        } else if (item.kind === 'branch-clipboard-toggle') {
          void configStore
            .getState()
            .update({ copyToClipboard: !(config?.copyToClipboard !== false) })
            .catch(() => {});
        } else if (item.kind === 'theme') {
          openOverlay({ type: 'theme-picker' });
        } else if (
          item.kind === 'color-status' ||
          item.kind === 'color-priority' ||
          item.kind === 'color-type' ||
          item.kind === 'color-label'
        ) {
          const fieldMap: Record<string, FieldType> = {
            'color-status': 'status',
            'color-priority': 'priority',
            'color-type': 'type',
            'color-label': 'label',
          };
          openOverlay({
            type: 'color-value-picker',
            fieldType: fieldMap[item.kind]!,
          });
        }
      }

      if (
        matchesCommand('settings-create-template', input, key) &&
        capabilities.templates
      ) {
        setFormMode('template');
        setEditingTemplateSlug(null);
        selectWorkItem(null);
        navigate('form');
      }

      if (matchesCommand('settings-delete-template', input, key)) {
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
        <Text bold color={accent}>
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
              <Text color={focused ? accent : undefined}>
                {focused ? '>' : ' '}{' '}
              </Text>
              <Text
                color={focused ? accent : undefined}
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
          item.kind === 'branch-command' ||
          item.kind === 'branch-clipboard-toggle' ||
          item.kind === 'updates-header' ||
          item.kind === 'update-now' ||
          item.kind === 'update-check' ||
          item.kind === 'update-toggle' ||
          item.kind === 'theme' ||
          item.kind === 'color-status' ||
          item.kind === 'color-priority' ||
          item.kind === 'color-type' ||
          item.kind === 'color-label'
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
            <Text color={focused ? accent : undefined}>
              {focused ? '>' : ' '}{' '}
            </Text>
            {isEditing ? (
              <Box>
                <Text bold color={accent}>
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
              <Text bold={focused} color={focused ? accent : undefined}>
                {label}:{' '}
                {value || (
                  <Text dimColor={mutedDim}>
                    {required ? '(required)' : '(optional)'}
                  </Text>
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
              <Text color={focused ? accent : undefined}>
                {focused ? '>' : ' '}{' '}
              </Text>
              <Text bold={focused} color={focused ? accent : undefined}>
                {label}: {value}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Branch:</Text>
        {navItems.map((item, idx) => {
          if (
            item.kind !== 'branch-command' &&
            item.kind !== 'branch-clipboard-toggle'
          )
            return null;
          const focused = idx === cursor;

          if (item.kind === 'branch-command') {
            const rawCmd =
              config?.branchCommand ?? defaultConfig.branchCommand ?? '';
            // "  Branch command: " prefix is ~20 chars + indicator
            const maxLen = Math.max(10, terminalWidth - 24);
            const truncCmd =
              rawCmd.length > maxLen
                ? rawCmd.slice(0, maxLen - 1) + '\u2026'
                : rawCmd;
            return (
              <Box key="branch-command" marginLeft={2}>
                <Text color={focused ? accent : undefined}>
                  {focused ? '>' : ' '}{' '}
                </Text>
                <Text bold={focused} color={focused ? accent : undefined}>
                  Branch command: {truncCmd || '(none)'}
                </Text>
                {focused && (
                  <Text dimColor={mutedDim}> [enter opens $EDITOR]</Text>
                )}
              </Box>
            );
          }

          if (item.kind === 'branch-clipboard-toggle') {
            return (
              <Box key="branch-clipboard-toggle" marginLeft={2}>
                <Text color={focused ? accent : undefined}>
                  {focused ? '>' : ' '}{' '}
                </Text>
                <Text bold={focused} color={focused ? accent : undefined}>
                  Copy to clipboard:{' '}
                  {config?.copyToClipboard !== false ? 'on' : 'off'}
                </Text>
              </Box>
            );
          }

          return null;
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Display:</Text>
        {navItems.map((item, idx) => {
          if (item.kind !== 'theme') return null;
          const focused = idx === cursor;
          return (
            <Box key="theme" marginLeft={2}>
              <Text color={focused ? accent : undefined}>
                {focused ? '>' : ' '}{' '}
              </Text>
              <Text bold={focused} color={focused ? accent : undefined}>
                Theme: {themeName}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Colors:</Text>
        {navItems.map((item, idx) => {
          if (
            item.kind !== 'color-status' &&
            item.kind !== 'color-priority' &&
            item.kind !== 'color-type' &&
            item.kind !== 'color-label'
          )
            return null;
          const focused = idx === cursor;
          const label: Record<string, string> = {
            'color-status': 'Status colors',
            'color-priority': 'Priority colors',
            'color-type': 'Type colors',
            'color-label': 'Label colors',
          };
          return (
            <Box key={item.kind} marginLeft={2}>
              <Text color={focused ? accent : undefined}>
                {focused ? '>' : ' '}{' '}
              </Text>
              <Text bold={focused} color={focused ? accent : undefined}>
                {label[item.kind]} →
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
                <Text color={focused ? accent : undefined}>
                  {focused ? '>' : ' '}{' '}
                </Text>
                <Text bold={focused} color={focused ? accent : undefined}>
                  {item.name}
                </Text>
              </Box>
            );
          })}
          {templates.length === 0 && (
            <Box marginLeft={2}>
              <Text dimColor={mutedDim}>
                (no templates — press c to create)
              </Text>
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold>Updates:</Text>
        <Box marginLeft={2}>
          <Text dimColor={mutedDim}>Current: v{VERSION}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor={mutedDim}>
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
                <Text color={focused ? accent : undefined}>
                  {focused ? '>' : ' '}{' '}
                </Text>
                <Text bold={focused} color={focused ? accent : success}>
                  Update to v{updateInfo?.latest}
                </Text>
              </Box>
            );
          }

          if (item.kind === 'update-check') {
            return (
              <Box key="update-check" marginLeft={2}>
                <Text color={focused ? accent : undefined}>
                  {focused ? '>' : ' '}{' '}
                </Text>
                <Text bold={focused} color={focused ? accent : undefined}>
                  {updateChecking ? 'Checking...' : 'Check for updates'}
                </Text>
              </Box>
            );
          }

          if (item.kind === 'update-toggle') {
            return (
              <Box key="update-toggle" marginLeft={2}>
                <Text color={focused ? accent : undefined}>
                  {focused ? '>' : ' '}{' '}
                </Text>
                <Text bold={focused} color={focused ? accent : undefined}>
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
        <OverlayPanel
          title="Default Type"
          items={config.types.map((t) => ({ id: t, label: t, value: t }))}
          onSelect={(item) => {
            void configStore
              .getState()
              .update({ defaultType: item.value })
              .catch(() => {});
            closeOverlay();
          }}
          onCancel={() => closeOverlay()}
          emptyMessage="(none configured)"
        />
      )}

      {activeOverlay?.type === 'default-iteration-picker' && (
        <OverlayPanel
          title="Default Iteration"
          items={config.iterations.map((i) => ({
            id: i.name,
            label: i.name,
            value: i.name,
          }))}
          onSelect={(item) => {
            void configStore
              .getState()
              .update({ current_iteration: item.value })
              .catch(() => {});
            closeOverlay();
          }}
          onCancel={() => closeOverlay()}
          emptyMessage="(none configured)"
        />
      )}

      {activeOverlay?.type === 'delete-template-confirm' && (
        <OverlayPanel
          title={`Delete template "${templates.find((t) => t.slug === activeOverlay.templateSlug)?.name ?? activeOverlay.templateSlug}"?`}
          items={[
            { id: 'yes', label: 'Yes, delete', value: 'yes' },
            { id: 'no', label: 'Cancel', value: 'no' },
          ]}
          onSelect={(item) => {
            if (item.value === 'yes') {
              const slug = activeOverlay.templateSlug;
              if (backend) {
                void backend
                  .deleteTemplate(slug)
                  .then(async () => {
                    setTemplates((prev) => prev.filter((t) => t.slug !== slug));
                    if (queue) {
                      await queue.append({
                        action: 'template-delete',
                        itemId: slug,
                        timestamp: new Date().toISOString(),
                        templateSlug: slug,
                      });
                      syncManager?.pushPending().catch((err: unknown) => {
                        uiStore
                          .getState()
                          .setToast(
                            err instanceof Error ? err.message : 'Sync failed',
                          );
                      });
                    }
                  })
                  .catch((err: unknown) => {
                    uiStore
                      .getState()
                      .setToast(
                        err instanceof Error
                          ? err.message
                          : 'Failed to delete template',
                      );
                  });
              }
            }
            closeOverlay();
          }}
          onCancel={() => closeOverlay()}
        />
      )}

      {activeOverlay?.type === 'theme-picker' && (
        <OverlayPanel
          title="Theme"
          items={Object.keys(themes).map((t) => ({
            id: t,
            label: t,
            value: t,
          }))}
          onSelect={(item) => {
            themeStore.getState().setTheme(item.value);
            closeOverlay();
          }}
          onCancel={() => closeOverlay()}
        />
      )}

      {activeOverlay?.type === 'color-value-picker' &&
        (() => {
          const ft = activeOverlay.fieldType as FieldType;
          const PRIORITIES = ['critical', 'high', 'medium', 'low'];
          const values =
            ft === 'status'
              ? config.statuses
              : ft === 'priority'
                ? PRIORITIES
                : ft === 'type'
                  ? config.types
                  : storeLabels;
          const overrides = themeStore.getState().colorOverrides[ft] ?? {};
          const items = [
            { id: '__reset_all__', label: 'Reset all', value: '__reset_all__' },
            ...values.map((v) => ({
              id: v,
              label: v,
              value: v,
              hint: overrides[v.toLowerCase()] ? '(custom)' : undefined,
            })),
          ];
          return (
            <OverlayPanel
              title={`${ft.charAt(0).toUpperCase() + ft.slice(1)} Colors`}
              items={items}
              fieldType={ft}
              onSelect={(item) => {
                if (item.value === '__reset_all__') {
                  void backendDataStore
                    .getState()
                    .deleteColorMappingsByField(ft)
                    .catch(() => {});
                  closeOverlay();
                } else {
                  openOverlay({
                    type: 'color-palette-picker',
                    fieldType: ft,
                    value: item.value,
                  });
                }
              }}
              onCancel={() => closeOverlay()}
              emptyMessage="(no values configured)"
            />
          );
        })()}

      {activeOverlay?.type === 'color-palette-picker' &&
        (() => {
          const ft = activeOverlay.fieldType as FieldType;
          const val = activeOverlay.value;
          const TERMINAL_COLORS = [
            'red',
            'green',
            'blue',
            'magenta',
            'cyan',
            'yellow',
            'gray',
            'white',
            'redBright',
            'greenBright',
            'blueBright',
            'magentaBright',
            'cyanBright',
            'yellowBright',
            'grayBright',
            'whiteBright',
          ];
          const items = [
            {
              id: '__reset__',
              label: 'Reset to default',
              value: '__reset__',
            },
            ...TERMINAL_COLORS.map((c) => ({
              id: c,
              label: `${val} (${c})`,
              value: c,
            })),
          ];
          return (
            <OverlayPanel
              title={`Pick color for "${val}"`}
              items={items}
              fieldType={ft}
              onSelect={(item) => {
                const store = backendDataStore.getState();
                if (item.value === '__reset__') {
                  void store.deleteColorMapping(ft, val).catch(() => {});
                } else {
                  const bg = item.value;
                  const fg = autoFg(bg);
                  void store.setColorMapping(ft, val, bg, fg).catch(() => {});
                }
                closeOverlay();
              }}
              onCancel={() => {
                // Go back to value picker
                openOverlay({ type: 'color-value-picker', fieldType: ft });
              }}
            />
          );
        })()}

      <Box marginTop={1}>
        <Text dimColor={mutedDim}>
          {capabilities.templates
            ? '↑↓ navigate  enter select  c create template  d delete template  esc back  ? help'
            : '↑↓ navigate  enter select  esc back  ? help'}
        </Text>
      </Box>
    </Box>
  );
}
