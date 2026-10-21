// Ranges follow the complete filtered order, including rows not mounted yet.
export function selectRange(
  order: readonly string[],
  selected: ReadonlySet<string>,
  anchor: string | null,
  target: string,
  { range = false, additive = false } = {},
) {
  const next = new Set(additive ? selected : []);
  const start = anchor === null ? -1 : order.indexOf(anchor);
  const end = order.indexOf(target);
  if (end < 0) return new Set(selected);
  if (range && start >= 0) {
    for (const key of order.slice(
      Math.min(start, end),
      Math.max(start, end) + 1,
    ))
      next.add(key);
  } else if (additive && selected.has(target)) next.delete(target);
  else next.add(target);
  return next;
}
