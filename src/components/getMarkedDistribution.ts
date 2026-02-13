export function getMarkedDistribution(
  markedIds: Set<string>,
  treeItems: { id: string }[],
  viewportStart: number,
  viewportEnd: number,
): { above: number; below: number } {
  if (markedIds.size === 0) return { above: 0, below: 0 };

  let above = 0;
  let below = 0;

  for (let i = 0; i < treeItems.length; i++) {
    const item = treeItems[i];
    if (!item || !markedIds.has(item.id)) continue;
    if (i < viewportStart) above++;
    else if (i >= viewportEnd) below++;
  }

  return { above, below };
}
