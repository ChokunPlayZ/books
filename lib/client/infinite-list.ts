import { LIST_BATCH_SIZE } from "../domain/lists.ts";
import { node, number } from "./dom.ts";

// Keep existing rows mounted while the next batch approaches the viewport.
export function createInfiniteList(
  list: HTMLElement,
  beforeReset?: () => void,
) {
  const status = node("div", "infinite-scroll");
  status.setAttribute("role", "status");
  status.hidden = true;
  list.after(status);

  let activeKey: string | undefined;
  let visibleCount = 0;
  let frame = 0;
  let disposed = false;
  let appendMore: (() => void) | undefined;
  let rows = new Map<string, Node>();
  const observer = new IntersectionObserver(
    (entries) => {
      if (disposed || frame || !entries.some((entry) => entry.isIntersecting))
        return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!disposed) appendMore?.();
      });
    },
    { rootMargin: "400px 0px" },
  );

  return {
    render<T>(
      items: readonly T[],
      renderItem: (item: T) => Node,
      {
        key,
        label,
        itemKey,
        updateItem,
      }: {
        key: string;
        label: string;
        itemKey?: (item: T) => string;
        updateItem?: (row: Node, item: T) => void;
      },
    ) {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      beforeReset?.();
      const initialCount =
        key === activeKey
          ? Math.max(LIST_BATCH_SIZE, visibleCount)
          : LIST_BATCH_SIZE;
      activeKey = key;
      visibleCount = 0;

      // Reconcile keyed rows without detaching covers that are already loaded.
      const previousRows = rows;
      rows = new Map();
      if (itemKey) {
        const retained = new Set(
          items
            .slice(0, initialCount)
            .map((item) => previousRows.get(itemKey(item))),
        );
        for (const child of [...list.childNodes])
          if (!retained.has(child)) list.removeChild(child);
      } else list.replaceChildren();
      let cursor = list.firstChild;

      function append(count: number) {
        const end = Math.min(visibleCount + count, items.length);
        for (; visibleCount < end; visibleCount++) {
          const item = items[visibleCount];
          const id = itemKey?.(item);
          let row = id === undefined ? undefined : previousRows.get(id);
          if (row) updateItem?.(row, item);
          else row = renderItem(item);
          if (id !== undefined) rows.set(id, row);
          if (row !== cursor) list.insertBefore(row, cursor);
          cursor = row.nextSibling;
        }
        while (cursor) {
          const next = cursor.nextSibling;
          list.removeChild(cursor);
          cursor = next;
        }
        status.hidden = !items.length;
        status.textContent =
          visibleCount < items.length
            ? `Showing ${number(visibleCount)} of ${number(items.length)} ${label}. More load as you scroll.`
            : `All ${number(items.length)} ${label} loaded.`;
        // Re-observing also fills tall viewports when a batch is still too short.
        observer.disconnect();
        if (visibleCount < items.length) observer.observe(status);
      }

      appendMore = () => append(LIST_BATCH_SIZE);
      append(initialCount);
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      appendMore = undefined;
      rows.clear();
      status.remove();
    },
  };
}
