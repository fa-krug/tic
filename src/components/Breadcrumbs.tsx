import { Box, Text } from 'ink';
import { useThemeStore } from '../stores/themeStore.js';
import { useFormStackStore } from '../stores/formStackStore.js';

interface BreadcrumbsProps {
  maxTitleLength?: number;
}

export function Breadcrumbs({ maxTitleLength = 30 }: BreadcrumbsProps) {
  const { mutedDim } = useThemeStore((s) => s.colors);
  const stack = useFormStackStore((s) => s.stack);

  if (stack.length <= 1) {
    return null;
  }

  const truncate = (title: string) => {
    if (title.length <= maxTitleLength) return title;
    return title.slice(0, maxTitleLength - 3) + '...';
  };

  return (
    <Box marginBottom={1}>
      {stack.map((draft, index) => (
        <Text
          key={draft.itemId ?? `new-${index}`}
          dimColor={index < stack.length - 1}
        >
          {index > 0 && <Text dimColor={mutedDim}> › </Text>}
          {truncate(draft.itemTitle)}
        </Text>
      ))}
    </Box>
  );
}
