export interface FormValues {
  title: string;
  type: string;
  status: string;
  iteration: string;
  priority: string;
  assignee: string;
  labels: string;
  description: string;
  parentId: string;
  dependsOn: string;
  newComment: string;
}

export type FormSnapshot = Readonly<FormValues>;

export function createSnapshot(values: FormValues): FormSnapshot {
  return { ...values };
}

export function isSnapshotEqual(a: FormSnapshot, b: FormSnapshot): boolean {
  return (
    a.title === b.title &&
    a.type === b.type &&
    a.status === b.status &&
    a.iteration === b.iteration &&
    a.priority === b.priority &&
    a.assignee === b.assignee &&
    a.labels === b.labels &&
    a.description === b.description &&
    a.parentId === b.parentId &&
    a.dependsOn === b.dependsOn &&
    a.newComment === b.newComment
  );
}
