import { $, node, number, fillOptions, requestId } from "./dom.ts";
import { selectRange } from "./selection.ts";
import { createSeriesMerge } from "./series-merge.ts";
import type { CollectionState } from "./state.ts";
import type { StoredBook } from "../types.ts";

type SelectionItem = { key: string; books: StoredBook[]; trashId?: string };
type BatchRequest = Parameters<
  import("../server/store.ts").Store["api"]["updateBooks"]
>[0];

export function createBulkSelection({
  signal,
  removed,
  getCollection,
  isBusy,
  setBusy,
  rpc,
  load,
  notify,
  errorAt,
}: {
  signal: AbortSignal;
  removed: boolean;
  getCollection: () => CollectionState["data"];
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
  rpc: (name: string, arg?: unknown) => Promise<unknown>;
  load: () => Promise<void>;
  notify: (text: string) => void;
  errorAt: (id: string, error: unknown) => void;
}) {
  let items: SelectionItem[] = [];
  let selected = new Set<string>();
  let anchor: string | null = null;
  let mode = false;
  let filterKey = "";
  let pending: { key: string; request: BatchRequest } | null = null;
  const list = $("bookList");
  const options = { signal };
  const grouped = $("toggleSelection")?.textContent.includes("series");
  const seriesMerge = createSeriesMerge({
    signal,
    getCollection,
    selectedSeries: () => [...selected],
    isBusy,
    setBusy,
    rpc,
    load,
    notify,
    errorAt,
    onMerged: () => clear(true),
  });

  function selectedBooks() {
    return items
      .filter((item) => selected.has(item.key))
      .flatMap((item) =>
        item.books.map((book) => ({
          row: book.row,
          token: book.token,
          ...(item.trashId ? { trashId: item.trashId } : {}),
        })),
      );
  }
  function syncControls() {
    if (!list) return;
    seriesMerge.syncControls();
    const busy = isBusy(),
      count = selectedBooks().length;
    $("bulkActions").hidden = !mode;
    $("toggleSelection").setAttribute("aria-pressed", String(mode));
    $("toggleSelection").textContent = mode
      ? "Done selecting"
      : grouped
        ? "Select series"
        : "Select books";
    $("selectionCount").textContent =
      `${number(count)} ${count === 1 ? "book" : "books"} selected` +
      (grouped && selected.size ? ` in ${number(selected.size)} series` : "");
    list.classList.toggle("is-selecting", mode);
    for (const row of list.querySelectorAll<HTMLElement>(
      "[data-selection-key]",
    )) {
      const checked = selected.has(row.dataset.selectionKey);
      row.classList.toggle("is-selected", checked);
      if (row instanceof HTMLButtonElement) {
        row.disabled = busy;
        if (mode) row.setAttribute("aria-pressed", String(checked));
        else row.removeAttribute("aria-pressed");
      } else if (mode)
        row.setAttribute(
          "aria-label",
          `${checked ? "Deselect" : "Select"} ${row.title}`,
        );
      else row.setAttribute("aria-label", row.dataset.openLabel);
      row.setAttribute("aria-disabled", String(busy));
    }
    list.querySelectorAll<HTMLButtonElement>(".restore").forEach((button) => {
      button.disabled = busy;
    });
    for (const id of [
      "toggleSelection",
      "selectAllBooks",
      "clearSelection",
      "bulkStatus",
      "applyBulkStatus",
      "bulkMoveBooks",
      "confirmBulkRemove",
      "cancelBulkRemove",
    ] as const) {
      const control = $(id);
      if (control)
        control.disabled =
          busy ||
          (["applyBulkStatus", "bulkMoveBooks", "confirmBulkRemove"].includes(
            id,
          ) &&
            !count);
    }
    $("selectAllBooks").disabled ||= !items.length;
  }
  function clear(exit = false) {
    selected.clear();
    anchor = null;
    pending = null;
    if (exit) mode = false;
    syncControls();
  }
  async function apply(action: BatchRequest["action"]) {
    if (isBusy()) return;
    const books = selectedBooks();
    if (!books.length) return;
    const content = {
      action,
      books,
      ...(action === "status" ? { status: $("bulkStatus").value } : {}),
    };
    const key = JSON.stringify(content);
    if (pending?.key !== key)
      pending = { key, request: { ...content, requestId: requestId() } };
    const errorId = action === "remove" ? "bulkRemoveError" : "pageError";
    $(errorId).hidden = true;
    setBusy(true);
    try {
      await rpc("updateBooks", pending.request);
      $("bulkRemoveDialog")?.close();
      clear(true);
      notify(
        `${number(books.length)} ${books.length === 1 ? "book" : "books"} ${action === "status" ? "marked as " + content.status : action === "remove" ? "removed. You can restore them from Recently removed" : "restored to your shelf"}.`,
      );
      try {
        await load();
      } catch {
        errorAt(
          "pageError",
          "The books were updated, but the list could not refresh. Press Refresh.",
        );
      }
    } catch (error) {
      errorAt(errorId, error);
    } finally {
      setBusy(false);
      syncControls();
    }
  }

  $("toggleSelection")?.addEventListener(
    "click",
    () => {
      if (!isBusy()) {
        mode ? clear(true) : (mode = true);
        syncControls();
      }
    },
    options,
  );
  $("clearSelection")?.addEventListener("click", () => clear(), options);
  $("selectAllBooks")?.addEventListener(
    "click",
    () => {
      if (!isBusy()) {
        selected = new Set(items.map((item) => item.key));
        anchor = items[0]?.key || null;
        syncControls();
      }
    },
    options,
  );
  $("applyBulkStatus")?.addEventListener(
    "click",
    () => void apply("status"),
    options,
  );
  $("bulkMoveBooks")?.addEventListener(
    "click",
    () => {
      if (isBusy()) return;
      if (removed) void apply("restore");
      else {
        $("bulkRemoveSummary").textContent =
          `Remove ${number(selectedBooks().length)} selected books from your shelf?`;
        $("bulkRemoveError").hidden = true;
        $("bulkRemoveDialog").showModal();
      }
    },
    options,
  );
  $("confirmBulkRemove")?.addEventListener(
    "click",
    () => void apply("remove"),
    options,
  );
  $("cancelBulkRemove")?.addEventListener(
    "click",
    () => $("bulkRemoveDialog").close(),
    options,
  );
  $("bulkRemoveDialog")?.addEventListener(
    "cancel",
    (event) => {
      if (isBusy()) event.preventDefault();
    },
    options,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        mode &&
        !isBusy() &&
        !document.querySelector("dialog[open]")
      )
        clear(true);
    },
    options,
  );

  return {
    syncControls,
    refresh(next: SelectionItem[], key: string, statuses: string[]) {
      if (!list) return;
      if (key !== filterKey) clear();
      filterKey = key;
      items = next;
      selected = new Set(
        [...selected].filter((key) => items.some((item) => item.key === key)),
      );
      if (!items.some((item) => item.key === anchor)) anchor = null;
      if ($("bulkStatus")) fillOptions("bulkStatus", statuses);
      syncControls();
    },
    decorate(row: HTMLElement, key: string) {
      row.dataset.selectionKey = key;
      row.dataset.openLabel = row.getAttribute("aria-label") || row.title;
      const indicator = node("span", "selection-check", "✓");
      indicator.setAttribute("aria-hidden", "true");
      row.append(indicator);
      row.addEventListener(
        "mousedown",
        (event: MouseEvent) => {
          if (event.shiftKey) event.preventDefault();
        },
        options,
      );
      if (
        !(row instanceof HTMLButtonElement) &&
        !(row instanceof HTMLAnchorElement)
      )
        row.addEventListener(
          "keydown",
          (event: KeyboardEvent) => {
            if (
              event.target === row &&
              (event.key === " " || event.key === "Enter")
            ) {
              event.preventDefault();
              row.dispatchEvent(
                new MouseEvent("click", {
                  bubbles: true,
                  ctrlKey: event.ctrlKey,
                  metaKey: event.metaKey,
                  shiftKey: event.shiftKey,
                }),
              );
            }
          },
          options,
        );
      row.addEventListener(
        "click",
        (event: MouseEvent) => {
          if (isBusy()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
          const modifier = event.ctrlKey || event.metaKey;
          if (!mode && !modifier && !event.shiftKey) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          mode = true;
          selected = selectRange(
            items.map((item) => item.key),
            selected,
            anchor,
            key,
            { range: event.shiftKey, additive: modifier || !event.shiftKey },
          );
          if (!event.shiftKey || anchor === null) anchor = key;
          pending = null;
          syncControls();
        },
        { ...options, capture: true },
      );
      row.classList.toggle("is-selected", selected.has(key));
      if (mode && row instanceof HTMLButtonElement)
        row.setAttribute("aria-pressed", String(selected.has(key)));
      if (mode && row instanceof HTMLAnchorElement)
        row.setAttribute(
          "aria-label",
          `${selected.has(key) ? "Deselect" : "Select"} ${row.title}`,
        );
      return row;
    },
  };
}
