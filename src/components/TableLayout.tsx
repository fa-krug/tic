import { Box, Text } from 'ink';
import type { BackendCapabilities } from '../backends/types.js';
import type { TreeItem } from './WorkItemList.js';

interface TableLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
}

const colId = 5;
const colStatus = 14;
const colPriority = 10;
const colAssignee = 12;

export function TableLayout({
  treeItems,
  cursor,
  capabilities,
}: TableLayoutProps) {
  return (
    <>
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
        {capabilities.fields.priority && (
          <Box width={colPriority}>
            <Text bold underline>
              Priority
            </Text>
          </Box>
        )}
        {capabilities.fields.assignee && (
          <Box width={colAssignee}>
            <Text bold underline>
              Assignee
            </Text>
          </Box>
        )}
      </Box>

      {treeItems.map((treeItem, idx) => {
        const { item, prefix } = treeItem;
        const selected = idx === cursor;
        const hasUnresolvedDeps = item.dependsOn.length > 0;
        return (
          <Box key={item.id}>
            <Box width={2}>
              <Text color="cyan">{selected ? '>' : ' '}</Text>
            </Box>
            <Box width={colId}>
              <Text color={selected ? 'cyan' : undefined} bold={selected}>
                {item.id}
              </Text>
            </Box>
            <Box flexGrow={1}>
              <Text color={selected ? 'cyan' : undefined} bold={selected}>
                {capabilities.relationships ? prefix : ''}
                {item.title}
              </Text>
            </Box>
            <Box width={colStatus}>
              <Text color={selected ? 'cyan' : undefined} bold={selected}>
                {capabilities.fields.dependsOn && hasUnresolvedDeps ? '⧗ ' : ''}
                {item.status}
              </Text>
            </Box>
            {capabilities.fields.priority && (
              <Box width={colPriority}>
                <Text color={selected ? 'cyan' : undefined} bold={selected}>
                  {item.priority}
                </Text>
              </Box>
            )}
            {capabilities.fields.assignee && (
              <Box width={colAssignee}>
                <Text color={selected ? 'cyan' : undefined} bold={selected}>
                  {item.assignee}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}
    </>
  );
}
