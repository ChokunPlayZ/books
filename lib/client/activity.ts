// Shared by React screens and the imperative collection controller. Each task
// owns its cleanup so a fast request cannot hide another request still running.
export function createActivityStore() {
  const tasks = new Map<symbol, string>();
  const listeners = new Set<() => void>();
  let snapshot = "";
  function publish() {
    const next = [...tasks.values()].at(-1) || "";
    if (next === snapshot) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    begin(label: string, signal?: AbortSignal) {
      if (signal?.aborted) return () => {};
      const id = Symbol();
      tasks.set(id, label);
      publish();
      const finish = () => {
        signal?.removeEventListener("abort", finish);
        tasks.delete(id);
        publish();
      };
      signal?.addEventListener("abort", finish, { once: true });
      return finish;
    },
  };
}

export const activity = createActivityStore();

export function requestActivityLabel(name: string) {
  if (/^(save|set|update|merge|remove|restore)/.test(name))
    return "Saving changes…";
  if (/search|lookup|Ownership/i.test(name)) return "Searching…";
  if (/Cover/.test(name)) return "Loading book covers…";
  if (/Publisher|Catalog|Categories|Title/.test(name))
    return "Checking publishers and bookshops…";
  return "Loading your library…";
}
