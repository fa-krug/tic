import type { WorkItem, Comment } from '../../types.js';

// --- GitLab Work Items GraphQL API types ---

export interface GlWorkItem {
  id: string; // 'gid://gitlab/WorkItem/123'
  iid: string;
  title: string;
  state: string; // 'OPEN' | 'CLOSED'
  workItemType: { name: string };
  widgets: GlWidget[];
  createdAt: string;
  updatedAt: string;
}

export type GlWidget =
  | {
      __typename: 'WorkItemWidgetDescription';
      description: string;
    }
  | {
      __typename: 'WorkItemWidgetAssignees';
      assignees: { nodes: Array<{ username: string }> };
    }
  | {
      __typename: 'WorkItemWidgetLabels';
      labels: { nodes: Array<{ title: string }> };
    }
  | {
      __typename: 'WorkItemWidgetMilestone';
      milestone: { title: string } | null;
    }
  | {
      __typename: 'WorkItemWidgetHierarchy';
      parent: {
        id: string;
        iid: string;
        workItemType: { name: string };
      } | null;
    }
  | {
      __typename: 'WorkItemWidgetNotes';
      discussions: {
        nodes: Array<{ notes: { nodes: GlNote[] } }>;
      };
    }
  | { __typename: string }; // catch-all for unknown widgets

export interface GlNote {
  author: { username: string };
  createdAt: string;
  body: string;
}

// --- Helper ---

type WidgetByType<T extends GlWidget['__typename']> = Extract<
  GlWidget,
  { __typename: T }
>;

function findWidget<T extends GlWidget['__typename']>(
  widgets: GlWidget[],
  typename: T,
): WidgetByType<T> | undefined {
  return widgets.find((w) => w.__typename === typename) as
    | WidgetByType<T>
    | undefined;
}

// --- Mappers ---

export function mapWorkItemToWorkItem(workItem: GlWorkItem): WorkItem {
  const type = workItem.workItemType.name.toLowerCase();

  const descWidget = findWidget(workItem.widgets, 'WorkItemWidgetDescription');
  const assigneesWidget = findWidget(
    workItem.widgets,
    'WorkItemWidgetAssignees',
  );
  const labelsWidget = findWidget(workItem.widgets, 'WorkItemWidgetLabels');
  const milestoneWidget = findWidget(
    workItem.widgets,
    'WorkItemWidgetMilestone',
  );
  const hierarchyWidget = findWidget(
    workItem.widgets,
    'WorkItemWidgetHierarchy',
  );
  const notesWidget = findWidget(workItem.widgets, 'WorkItemWidgetNotes');

  const parent = hierarchyWidget?.parent
    ? `${hierarchyWidget.parent.workItemType.name.toLowerCase()}-${hierarchyWidget.parent.iid}`
    : null;

  const comments: Comment[] = notesWidget
    ? notesWidget.discussions.nodes.flatMap((d) =>
        d.notes.nodes.map(mapNoteToComment),
      )
    : [];

  return {
    id: `${type}-${workItem.iid}`,
    title: workItem.title,
    description: descWidget?.description ?? '',
    status: workItem.state === 'CLOSED' ? 'closed' : 'open',
    type,
    assignee: assigneesWidget?.assignees.nodes[0]?.username ?? '',
    labels: labelsWidget?.labels.nodes.map((l) => l.title) ?? [],
    iteration: milestoneWidget?.milestone?.title ?? '',
    priority: 'medium',
    created: workItem.createdAt,
    updated: workItem.updatedAt,
    parent,
    dependsOn: [],
    comments,
  };
}

export function mapNoteToComment(note: GlNote): Comment {
  return {
    author: note.author.username,
    date: note.createdAt,
    body: note.body,
  };
}
