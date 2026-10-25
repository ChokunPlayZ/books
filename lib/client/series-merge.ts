import { $, node, number, requestId } from "./dom.ts";
import type { CollectionState } from "./state.ts";

type MergeRequest = Parameters<
  import("../server/store.ts").Store["api"]["mergeSeries"]
>[0];

export function createSeriesMerge({
  signal,
  getCollection,
  selectedSeries,
  isBusy,
  setBusy,
  rpc,
  load,
  notify,
  errorAt,
  onMerged,
}: {
  signal: AbortSignal;
  getCollection: () => CollectionState["data"];
  selectedSeries: () => string[];
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
  rpc: (name: string, arg?: unknown) => Promise<unknown>;
  load: () => Promise<void>;
  notify: (text: string) => void;
  errorAt: (id: string, error: unknown) => void;
  onMerged: () => void;
}) {
  const dialog = $("mergeSeriesDialog");
  if (!dialog) return { syncControls() {} };
  const options = { signal };
  let titles: MergeRequest["titles"] = [];
  let pending: { key: string; request: MergeRequest } | null = null;

  function syncControls() {
    const busy = isBusy();
    $("mergeSeriesButton").disabled = busy || selectedSeries().length < 2;
    for (const id of [
      "mergeSeriesName",
      "closeMergeSeries",
      "cancelMergeSeries",
      "confirmMergeSeries",
    ] as const)
      $(id).disabled = busy;
    $("confirmMergeSeries").textContent = busy ? "Merging…" : "Merge series";
  }

  function close() {
    if (!isBusy()) dialog.close();
  }

  $("mergeSeriesButton").addEventListener(
    "click",
    () => {
      if (isBusy()) return;
      const data = getCollection();
      if (!data) return;
      const selected = new Set(selectedSeries());
      titles = data.titles.filter((title) => selected.has(title.series));
      if (titles.length < 2) return;
      pending = null;
      $("mergeSeriesError").hidden = true;
      $("mergeSeriesName").replaceChildren();
      $("mergeSeriesPreview").replaceChildren();
      let total = 0;
      for (const title of titles) {
        const books = data.books.filter((book) => book.series === title.series);
        const count = books.length;
        const volumes = [...books]
          .sort(
            (a, b) =>
              (a.volume === "" ? Infinity : a.volume) -
                (b.volume === "" ? Infinity : b.volume) || a.row - b.row,
          )
          .map((book) =>
            book.volume === "" ? "Unnumbered" : `Vol. ${number(book.volume)}`,
          );
        total += count;
        const option = node("option", "", title.series);
        option.value = title.series;
        $("mergeSeriesName").append(option);
        const item = node("li");
        item.append(
          node("strong", "", title.series),
          node(
            "span",
            "hint",
            `${number(count)} ${count === 1 ? "volume" : "volumes"} · ${volumes.join(", ")}`,
          ),
        );
        $("mergeSeriesPreview").append(item);
      }
      $("mergeSeriesSummary").textContent =
        `${number(titles.length)} series will become one, with ${number(total)} owned volumes.`;
      syncControls();
      dialog.showModal();
      $("mergeSeriesName").focus();
    },
    options,
  );
  $("closeMergeSeries").addEventListener("click", close, options);
  $("cancelMergeSeries").addEventListener("click", close, options);
  dialog.addEventListener(
    "cancel",
    (event) => {
      if (isBusy()) event.preventDefault();
    },
    options,
  );
  $("mergeSeriesForm").addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      if (
        isBusy() ||
        titles.length < 2 ||
        !$("mergeSeriesForm").reportValidity()
      )
        return;
      const content = { titles, series: $("mergeSeriesName").value };
      const key = JSON.stringify(content);
      if (pending?.key !== key)
        pending = { key, request: { ...content, requestId: requestId() } };
      $("mergeSeriesError").hidden = true;
      setBusy(true);
      syncControls();
      try {
        await rpc("mergeSeries", pending.request);
        dialog.close();
        pending = null;
        onMerged();
        notify(
          `Merged ${number(titles.length)} series into “${content.series}”.`,
        );
        try {
          await load();
        } catch {
          errorAt(
            "pageError",
            "The series were merged, but the list could not refresh. Press Refresh.",
          );
        }
      } catch (error) {
        errorAt("mergeSeriesError", error);
      } finally {
        setBusy(false);
        syncControls();
      }
    },
    options,
  );
  return { syncControls };
}
