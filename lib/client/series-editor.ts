import { $, node, requestId } from "./dom.ts";
import type { CollectionState } from "./state.ts";
import type { StoredBook } from "../types.ts";

type EditRow = {
  book: StoredBook;
  element: HTMLTableRowElement;
  date: HTMLInputElement;
  price: HTMLInputElement;
  source: HTMLInputElement;
};

export function createSeriesEditor({
  state,
  signal,
  rpc,
  reload,
  notify,
  setBusy,
}: {
  state: CollectionState;
  signal: AbortSignal;
  rpc: (name: string, arg: unknown) => Promise<{ volumes: number }>;
  reload: () => Promise<void>;
  notify: (message: string) => void;
  setBusy: (busy: boolean) => void;
}) {
  const form = $("seriesEditor");
  if (!form) return { syncControls() {} };

  let active = false;
  let rows: EditRow[] = [];
  let pending: {
    key: string;
    request: {
      requestId: string;
      series: string;
      changes: ReturnType<typeof changes>;
    };
  } | null = null;

  function ownedBooks() {
    return (state.data?.books ?? []).filter(
      (book) =>
        (book.series.trim() || "Untitled series") === state.selectedSeries,
    );
  }

  function changed(row: EditRow) {
    const price = row.price.value;
    const samePrice =
      !row.price.validity.badInput &&
      (price === ""
        ? row.book.price === ""
        : row.book.price !== "" && Number(price) === row.book.price);
    return (
      !samePrice ||
      row.date.value !== row.book.date ||
      row.source.value.trim() !== row.book.source
    );
  }

  function changes() {
    return rows.filter(changed).map((row) => ({
      row: row.book.row,
      token: row.book.token,
      date: row.date.value,
      price: row.price.value,
      source: row.source.value.trim(),
    }));
  }

  function syncControls() {
    const count = rows.filter(changed).length;
    $("editVolumesButton").disabled =
      state.busy || active || !ownedBooks().length;
    for (const id of [
      "addButton",
      "checkBookButton",
      "editTitleButton",
    ] as const)
      $(id).disabled = state.busy || active || !state.data;
    $("saveSeriesEdits").disabled = state.busy || !count;
    $("saveSeriesEdits").textContent = state.busy ? "Saving…" : "Save changes";
    $("cancelSeriesEdit").disabled = state.busy;
    $("cancelSeriesEdit").textContent = count ? "Discard changes" : "Done";
    $("seriesSaveStatus").textContent = state.busy
      ? "Saving your changes…"
      : count
        ? `Unsaved changes · ${count} ${count === 1 ? "volume" : "volumes"}`
        : "No unsaved changes";
    $("seriesSaveHint").textContent = count
      ? "Save your changes before leaving this page."
      : "Your edits stay here until you save.";
    $("seriesSaveBar").classList.toggle("is-dirty", count > 0);
    for (const row of rows) {
      row.element.classList.toggle("is-dirty", changed(row));
      row.date.disabled = row.price.disabled = row.source.disabled = state.busy;
    }
  }

  function open() {
    if (state.busy || active || !ownedBooks().length) return;
    rows = ownedBooks()
      .sort(
        (a, b) =>
          (a.volume === "" ? Infinity : a.volume) -
            (b.volume === "" ? Infinity : b.volume) || a.row - b.row,
      )
      .map((book) => {
        const element = node("tr");
        element.dataset.row = String(book.row);
        const heading = node("th");
        heading.scope = "row";
        const volume =
          book.volume === "" ? "Unnumbered" : `Volume ${book.volume}`;
        const edition = [book.type, book.publisher].filter(Boolean).join(" · ");
        heading.append(
          node("strong", "", volume),
          node("span", "hint", edition),
        );
        if (book.isbn) heading.append(node("span", "hint", book.isbn));
        element.append(heading);
        const inputs = {} as Pick<EditRow, "date" | "price" | "source">;
        for (const field of ["date", "price", "source"] as const) {
          const input = node("input");
          input.name = field;
          input.type =
            field === "price" ? "number" : field === "date" ? "date" : "text";
          input.value = String(book[field]);
          input.setAttribute(
            "aria-label",
            `${field === "date" ? "Purchase date" : field === "price" ? "Price paid" : "Bought from"} for ${volume}, ${edition}`,
          );
          if (field === "date") {
            input.min = "1900-01-01";
            input.max = "9999-12-31";
          } else if (field === "price") {
            input.min = "0";
            input.step = "any";
            input.inputMode = "decimal";
            input.placeholder = "Not recorded";
          } else {
            input.maxLength = 500;
            input.setAttribute("list", "sourceOptions");
            input.placeholder = "Store or seller";
          }
          inputs[field] = input;
          const cell = node("td");
          cell.append(input);
          element.append(cell);
        }
        return { book: { ...book }, element, ...inputs };
      });
    $("seriesEditRows").replaceChildren(...rows.map((row) => row.element));
    pending = null;
    active = true;
    $("seriesEditError").hidden = true;
    form.hidden = false;
    $("libraryMain").classList.add("series-editing");
    $("editVolumesButton").setAttribute("aria-expanded", "true");
    syncControls();
    $("seriesEditorTitle").focus();
  }

  function close() {
    active = false;
    rows = [];
    pending = null;
    form.hidden = true;
    $("seriesEditRows").replaceChildren();
    $("libraryMain").classList.remove("series-editing");
    $("editVolumesButton").setAttribute("aria-expanded", "false");
    syncControls();
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (state.busy || !active || !form.reportValidity()) return;
    const edits = changes();
    if (!edits.length) return;
    const content = { series: state.selectedSeries!, changes: edits };
    const key = JSON.stringify(content);
    if (pending?.key !== key)
      pending = { key, request: { ...content, requestId: requestId() } };
    $("seriesEditError").hidden = true;
    setBusy(true);
    form.setAttribute("aria-busy", "true");
    try {
      const result = await rpc("saveSeriesPurchases", pending.request);
      close();
      notify(
        `Purchase details saved for ${result.volumes} ${result.volumes === 1 ? "volume" : "volumes"}.`,
      );
      try {
        await reload();
      } catch {
        $("pageError").textContent =
          "Your changes were saved, but the list could not refresh. Press Refresh to see them.";
        $("pageError").hidden = false;
      }
    } catch (error) {
      $("seriesEditError").textContent =
        error instanceof Error ? error.message : String(error);
      $("seriesEditError").hidden = false;
    } finally {
      setBusy(false);
      form.removeAttribute("aria-busy");
      if (!active) $("editVolumesButton").focus();
    }
  }

  $("editVolumesButton").addEventListener("click", open, { signal });
  $("cancelSeriesEdit").addEventListener(
    "click",
    () => {
      if (state.busy) return;
      close();
      $("editVolumesButton").focus();
    },
    { signal },
  );
  form.addEventListener(
    "input",
    () => {
      $("seriesEditError").hidden = true;
      syncControls();
    },
    { signal },
  );
  form.addEventListener("submit", (event) => void save(event), { signal });
  window.addEventListener(
    "beforeunload",
    (event) => {
      if (!active || !rows.some(changed)) return;
      event.preventDefault();
      event.returnValue = "";
    },
    { signal },
  );

  return { syncControls };
}
