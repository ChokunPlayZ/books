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
      { key, label }: { key: string; label: string },
    ) {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      beforeReset?.();
      list.replaceChildren();
      const initialCount =
        key === activeKey
          ? Math.max(LIST_BATCH_SIZE, visibleCount)
          : LIST_BATCH_SIZE;
      activeKey = key;
      visibleCount = 0;

      function append(count: number) {
        const end = Math.min(visibleCount + count, items.length);
        const batch = document.createDocumentFragment();
        for (; visibleCount < end; visibleCount++)
          batch.append(renderItem(items[visibleCount]));
        list.append(batch);
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
      status.remove();
    },
  };
}
