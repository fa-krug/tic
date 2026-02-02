import { Box, Text } from 'ink';
import { readConfigSync } from '../backends/local/config.js';
import os from 'node:os';

const VERSION = '0.1.0';

const BACKEND_LABELS: Record<string, string> = {
  local: 'Local',
  github: 'GitHub',
  gitlab: 'GitLab',
  azure: 'Azure DevOps',
};

function shortenPath(fullPath: string): string {
  const home = os.homedir();
  if (fullPath.startsWith(home)) {
    return '~' + fullPath.slice(home.length);
  }
  return fullPath;
}

// Checkmark icon in block characters
const ART_LINES = ['        ██', ' ██    ██ ', '  ██  ██  ', '   ████   '];

export function Header() {
  const root = process.cwd();
  const config = readConfigSync(root);
  const backendType = config.backend ?? 'local';
  const backendLabel = BACKEND_LABELS[backendType] ?? backendType;
  const projectPath = shortenPath(root);

  return (
    <Box marginBottom={1}>
      <Box flexDirection="column" marginRight={3}>
        {ART_LINES.map((line, i) => (
          <Text key={i} color="green">
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" justifyContent="center">
        <Text>
          <Text bold>tic</Text>
          <Text dimColor> v{VERSION}</Text>
        </Text>
        <Text dimColor>
          {backendLabel} · {projectPath}
        </Text>
      </Box>
    </Box>
  );
}
