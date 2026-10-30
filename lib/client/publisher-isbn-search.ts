import { canonicalIsbn } from "../domain/isbn.ts";
import { bookSourceApplies } from "../domain/book-sources.ts";
import type { Release } from "../types.ts";

type SearchResult = {
  isbn: string;
  publisherId: string;
  url?: string;
  items: Release[];
  warnings?: string[];
  loading?: boolean;
  error?: string;
};

export function createPublisherIsbnSearch({
  rpc,
  signal,
  onChange,
}: {
  rpc: (name: string, arg?: unknown) => Promise<unknown>;
  signal: AbortSignal;
  onChange: () => void;
}) {
  const results = new Map<string, SearchResult>();
  let timer: ReturnType<typeof setTimeout>;
  let waitingKey = "";
  let refreshNext = false;
  const cancel = () => {
    clearTimeout(timer);
    if (waitingKey) results.delete(waitingKey);
    waitingKey = "";
  };
  signal.addEventListener("abort", cancel, { once: true });
  return {
    get(publisherId: string, query: string) {
      const isbn = canonicalIsbn(query);
      if (
        !isbn ||
        !bookSourceApplies(publisherId, { isbn }) ||
        ![
          "phoenix",
          "firstpage",
          "animag",
          "dexpress",
          "lilyhouse",
          "kodansha",
        ].includes(publisherId)
      ) {
        cancel();
        return null;
      }
      const key = publisherId + ":" + isbn;
      if (waitingKey && waitingKey !== key) cancel();
      if (!results.has(key)) {
        const refresh = refreshNext;
        refreshNext = false;
        const result: SearchResult = {
          isbn,
          publisherId,
          loading: true,
          items: [],
        };
        results.set(key, result);
        waitingKey = key;
        timer = setTimeout(async () => {
          waitingKey = "";
          try {
            const response = (await rpc("searchPublisherIsbn", {
              publisherId,
              isbn,
              ...(refresh ? { refresh: true } : {}),
            })) as SearchResult;
            if (signal.aborted || results.get(key) !== result) return;
            results.set(key, response);
          } catch (error) {
            if (signal.aborted || results.get(key) !== result) return;
            results.set(key, {
              ...result,
              loading: false,
              error: error.message || String(error),
            });
          }
          if (!signal.aborted) onChange();
        }, 350);
      }
      return results.get(key);
    },
    clear() {
      cancel();
      results.clear();
      refreshNext = true;
    },
  };
}
