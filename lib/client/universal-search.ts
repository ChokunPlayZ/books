import {
  mergeSearchResults,
  type KnownSearch,
  type ExternalSearch,
  type SearchResult,
} from "../domain/search.ts";

export type SearchProgress = {
  query: string;
  results: SearchResult[];
  sources: (KnownSearch["sources"][number] & {
    status: "pending" | ExternalSearch["status"];
  })[];
  phase: "known" | "background" | "complete";
};

// Independent source responses are published immediately; the slowest source
// never holds up a better match. All updates belong to the same abort signal.
export async function runUniversalSearch({
  query,
  signal,
  rpc,
  onProgress,
}: {
  query: string;
  signal: AbortSignal;
  rpc: (name: string, arg: unknown, signal: AbortSignal) => Promise<unknown>;
  onProgress: (progress: SearchProgress) => void;
}) {
  if (signal.aborted) return;
  const known = (await rpc(
    "searchKnownEntities",
    { query },
    signal,
  )) as KnownSearch;
  if (signal.aborted) return;
  let results = known.results;
  const sources: SearchProgress["sources"] = known.sources.map((source) => ({
    ...source,
    status: "pending",
  }));
  const publish = (phase: SearchProgress["phase"]) => {
    if (!signal.aborted)
      onProgress({
        query: known.query,
        results,
        sources: sources.map((source) => ({ ...source })),
        phase,
      });
  };
  publish("known");
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, sources.length) }, async () => {
      while (!signal.aborted && cursor < sources.length) {
        const index = cursor++;
        try {
          const response = (await rpc(
            "searchExternalTitles",
            { query: known.query, sourceId: sources[index].id },
            signal,
          )) as ExternalSearch;
          if (signal.aborted) return;
          results = mergeSearchResults(known.query, results, response.results);
          sources[index].status = response.status;
        } catch {
          if (signal.aborted) return;
          sources[index].status = "unavailable";
        }
        publish("background");
      }
    }),
  );
  publish("complete");
}
