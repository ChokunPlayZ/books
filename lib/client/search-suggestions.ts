import { searchKey } from "../domain/search.ts";
import {
  canSuggest,
  mergeSuggestions,
  SUFFICIENT_SUGGESTIONS,
  type QuerySuggestions,
  type SearchSuggestion,
} from "../domain/search-suggestions.ts";

type Rpc = (
  name: string,
  arg: unknown,
  signal: AbortSignal,
) => Promise<unknown>;

function pause(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve(false);
  if (!milliseconds) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve(!signal.aborted);
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

// This bounded cache belongs to one mounted, signed-in search field. Never
// persist private library suggestions in localStorage or a shared browser cache.
export function createSuggestionClient(rpc: Rpc) {
  const answers = new Map<
    string,
    { suggestions: SearchSuggestion[]; expires: number }
  >();
  function cached(query: string) {
    if (!canSuggest(query)) return [];
    return mergeSuggestions(
      query,
      [...answers.values()]
        .filter((answer) => answer.expires > Date.now())
        .flatMap((answer) => answer.suggestions),
    );
  }
  async function run({
    query,
    signal,
    onSuggestions,
    remoteDelay = 300,
  }: {
    query: string;
    signal: AbortSignal;
    onSuggestions: (suggestions: SearchSuggestion[]) => void;
    remoteDelay?: number;
  }) {
    if (signal.aborted || !canSuggest(query)) return;
    const key = searchKey(query);
    const previous = answers.get(key);
    if (previous && previous.expires > Date.now()) {
      onSuggestions(previous.suggestions);
      return;
    }
    let suggestions = cached(query);
    let unavailable = false;
    const publish = () => {
      if (!signal.aborted) onSuggestions(suggestions);
    };
    publish();
    try {
      const known = (await rpc(
        "searchKnownSuggestions",
        { query },
        signal,
      )) as QuerySuggestions;
      if (signal.aborted) return;
      suggestions = mergeSuggestions(query, [
        ...suggestions,
        ...known.suggestions,
      ]);
      publish();
      if (
        suggestions.length < SUFFICIENT_SUGGESTIONS &&
        known.sources.length &&
        (await pause(remoteDelay, signal))
      ) {
        let cursor = 0;
        await Promise.all(
          Array.from(
            { length: Math.min(2, known.sources.length) },
            async () => {
              while (
                !signal.aborted &&
                suggestions.length < SUFFICIENT_SUGGESTIONS &&
                cursor < known.sources.length
              ) {
                const source = known.sources[cursor++];
                try {
                  const response = (await rpc(
                    "searchExternalSuggestions",
                    { query, sourceId: source.id },
                    signal,
                  )) as QuerySuggestions;
                  if (signal.aborted) return;
                  unavailable ||= !!response.unavailable;
                  suggestions = mergeSuggestions(query, [
                    ...suggestions,
                    ...response.suggestions,
                  ]);
                  publish();
                } catch {
                  unavailable = true;
                }
              }
            },
          ),
        );
      }
      if (signal.aborted) return;
      answers.delete(key);
      answers.set(key, {
        suggestions,
        expires: Date.now() + (unavailable ? 15_000 : 300_000),
      });
      if (answers.size > 50) answers.delete(answers.keys().next().value!);
    } catch {
      /* Completion is optional. Keep local matches and free-text entry. */
    }
  }
  return { cached, run };
}
