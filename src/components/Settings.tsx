import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useAppState } from '../app.js';
import { readConfig, writeConfig } from '../backends/local/config.js';
import type { Config } from '../backends/local/config.js';
import { VALID_BACKENDS } from '../backends/factory.js';

type NavItem =
  | { kind: 'backend'; backend: string }
  | { kind: 'jira-field'; field: 'site' | 'project' | 'boardId' };

const JIRA_FIELDS = ['site', 'project', 'boardId'] as const;

function isAvailable(b: string): boolean {
  return b === 'local' || b === 'github' || b === 'jira';
}

export function Settings() {
  const { navigate } = useAppState();
  const root = process.cwd();

  const [config, setConfig] = useState<Config | null>(null);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [jiraSite, setJiraSite] = useState('');
  const [jiraProject, setJiraProject] = useState('');
  const [jiraBoardId, setJiraBoardId] = useState('');

  useEffect(() => {
    void readConfig(root).then(setConfig);
  }, [root]);

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

  // Build navigable items list — backends + conditional jira fields
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
    return items;
  }, [config?.backend]);

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

      if (key.escape || input === ',') {
        navigate('list');
        return;
      }

      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(navItems.length - 1, c + 1));
      }

      if (key.return) {
        const item = navItems[cursor]!;
        if (item.kind === 'backend') {
          if (!isAvailable(item.backend)) return;
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
          const b = item.backend;
          const isCurrent = b === config.backend;
          const available = isAvailable(b);
          return (
            <Box key={b}>
              <Text color={focused ? 'cyan' : undefined}>
                {focused ? '>' : ' '}{' '}
              </Text>
              <Text
                color={focused ? 'cyan' : undefined}
                bold={focused}
                dimColor={!available}
              >
                {b}
                {isCurrent ? ' (current)' : ''}
                {!available ? ' (not yet available)' : ''}
              </Text>
            </Box>
          );
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

      <Box marginTop={1}>
        <Text dimColor>
          {editing
            ? 'type to edit  enter/esc: confirm'
            : navItems[cursor]?.kind === 'jira-field'
              ? 'up/down: navigate  enter: edit field  esc/,: back'
              : 'up/down: navigate  enter: select  esc/,: back'}
        </Text>
      </Box>
    </Box>
  );
}
