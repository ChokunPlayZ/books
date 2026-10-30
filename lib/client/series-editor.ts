import { $, node, requestId } from "./dom.ts";
import type { CollectionState } from "./state.ts";
import type { StoredBook } from "../types.ts";

const labels = {
  volume: "Volume number",
  pageCount: "Pages",
  status: "Reading status",
  date: "Purchase date",
  price: "Price paid (฿)",
  source: "Bought from",
  isbn: "ISBN",
  type: "Book type / language",
  publisher: "Publisher",
  note: "Notes",
  coverUrl: "Cover image URL",
  publisherUrl: "Publisher product URL",
};
type Field = keyof typeof labels;
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type EditRow = {
  book: StoredBook;
  element: HTMLTableRowElement;
  details: HTMLTableRowElement;
  toggle: HTMLButtonElement;
  heading: HTMLElement;
  metadata: HTMLElement;
  inputs: Record<Field, Control>;
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

  function fieldChanged(row: EditRow, field: Field) {
    const input = row.inputs[field];
    const value = input.value.trim();
    if (field === "price" || field === "volume" || field === "pageCount")
      return (
        input.validity.badInput ||
        (value === ""
          ? row.book[field] != null && row.book[field] !== ""
          : row.book[field] === "" || Number(value) !== row.book[field])
      );
    return value !== row.book[field];
  }

  function changed(row: EditRow) {
    return (Object.keys(labels) as Field[]).some((field) =>
      fieldChanged(row, field),
    );
  }

  function changes() {
    return rows.filter(changed).map((row) => ({
      row: row.book.row,
      token: row.book.token,
      book: Object.fromEntries(
        (Object.keys(labels) as Field[])
          .filter((field) => fieldChanged(row, field))
          .map((field) => [field, row.inputs[field].value.trim()]),
      ),
    }));
  }

  function syncControls() {
    const count = rows.filter(changed).length;
    $("exportSeriesButton").hidden = !ownedBooks().length;
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
      row.details.classList.toggle("is-dirty", changed(row));
      row.toggle.disabled = state.busy;
      const volume = row.inputs.volume.value.trim();
      row.heading.textContent =
        volume === "" ? "Unnumbered" : `Volume ${volume}`;
      row.metadata.textContent = [
        row.inputs.type.value,
        row.inputs.publisher.value.trim(),
        row.inputs.isbn.value.trim(),
      ]
        .filter(Boolean)
        .join(" · ");
      for (const input of Object.values(row.inputs))
        input.disabled = state.busy;
    }
  }

  function showDetails(row: EditRow, expanded: boolean) {
    row.details.hidden = !expanded;
    row.toggle.setAttribute("aria-expanded", String(expanded));
    row.toggle.textContent = expanded ? "Hide details" : "Book details";
  }

  function editField(
    book: StoredBook,
    field: Field,
    inputs: EditRow["inputs"],
    compact = false,
  ) {
    const wrapper = node("div", "field");
    const label = node("label", "", labels[field]);
    const id = `volume-${book.row}-${field}`;
    label.htmlFor = id;
    if (compact) {
      label.className = "sr-only";
      label.textContent += ` for ${book.volume === "" ? "unnumbered volume" : "Volume " + book.volume}, ${book.type}, ${book.publisher}`;
    }
    let input: Control;
    if (field === "status" || field === "type") {
      input = node("select");
      const options = [
        ...new Set([book[field], ...state.data!.options[field]]),
      ];
      for (const value of options) {
        const option = node(
          "option",
          "",
          value || "Choose " + (field === "type" ? "a type" : "a status"),
        );
        option.value = value;
        input.append(option);
      }
      input.required = true;
    } else if (field === "note") {
      input = node("textarea");
      input.rows = 3;
      input.maxLength = 2000;
      wrapper.classList.add("span-2");
    } else {
      input = node("input");
      input.type = ["volume", "price", "pageCount"].includes(field)
        ? "number"
        : field === "date"
          ? "date"
          : field.endsWith("Url")
            ? "url"
            : "text";
      input.maxLength = field.endsWith("Url") ? 2000 : 500;
      if (field === "volume" || field === "price") {
        input.min = "0";
        input.step = "any";
        input.inputMode = "decimal";
        input.placeholder = field === "volume" ? "Unnumbered" : "Not recorded";
      } else if (field === "pageCount") {
        input.min = "1";
        input.step = "1";
        input.inputMode = "numeric";
        input.placeholder = "Not recorded";
      } else if (field === "date") {
        input.min = "1900-01-01";
        input.max = "9999-12-31";
      } else if (field === "publisher" || field === "source") {
        input.setAttribute("list", field + "Options");
        input.placeholder =
          field === "source"
            ? "Store or seller"
            : "Choose or enter a publisher";
      } else if (field === "isbn") {
        input.placeholder = "978… or ISBN-10";
        input.maxLength = 40;
      } else {
        input.placeholder = "https://…";
      }
    }
    input.id = id;
    input.name = field;
    input.value = String(book[field] ?? "");
    inputs[field] = input;
    wrapper.append(label, input);
    return wrapper;
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
        const element = node("tr", "series-edit-volume");
        element.dataset.row = String(book.row);
        const headingCell = node("th");
        headingCell.scope = "row";
        const volume =
          book.volume === "" ? "Unnumbered volume" : `Volume ${book.volume}`;
        const title = node("strong", "", volume);
        title.id = `volume-${book.row}-title`;
        const metadata = node(
          "span",
          "hint",
          [book.type, book.publisher, book.isbn].filter(Boolean).join(" · "),
        );
        headingCell.append(title, metadata);
        element.append(headingCell);
        const inputs = {} as EditRow["inputs"];
        for (const field of ["status", "date", "price", "source"] as const) {
          const cell = node("td");
          cell.append(editField(book, field, inputs, true));
          element.append(cell);
        }
        const details = node("tr", "series-edit-details");
        details.id = `volume-${book.row}-details`;
        details.hidden = true;
        const detailsCell = node("td");
        detailsCell.colSpan = 6;
        const detailsBody = node("div", "series-edit-details-body");
        const detailsTitle = node(
          "h3",
          "",
          `Book details for ${volume.toLowerCase()}`,
        );
        detailsTitle.id = `volume-${book.row}-details-title`;
        detailsBody.setAttribute("role", "group");
        detailsBody.setAttribute("aria-labelledby", detailsTitle.id);
        const fields = node("div", "series-edit-metadata");
        for (const field of [
          "volume",
          "isbn",
          "type",
          "publisher",
          "pageCount",
          "note",
          "coverUrl",
          "publisherUrl",
        ] as const)
          fields.append(editField(book, field, inputs));
        detailsBody.append(
          detailsTitle,
          fields,
          node(
            "p",
            "hint",
            "Edition changes apply to this copy only. Use supported publisher or book metadata links for covers; clear the cover URL to use automatic artwork.",
          ),
        );
        detailsCell.append(detailsBody);
        details.append(detailsCell);
        const toggleCell = node("td");
        const toggle = node("button", "btn series-edit-toggle", "Book details");
        toggle.type = "button";
        toggle.setAttribute("aria-controls", details.id);
        toggle.setAttribute("aria-expanded", "false");
        toggleCell.append(toggle);
        element.append(toggleCell);
        const row = {
          book: { ...book },
          element,
          details,
          toggle,
          heading: title,
          metadata,
          inputs,
        };
        return row;
      });
    $("seriesEditRows").replaceChildren(
      ...rows.flatMap((row) => [row.element, row.details]),
    );
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
      const result = await rpc("saveSeriesVolumes", pending.request);
      close();
      notify(
        `Details saved for ${result.volumes} ${result.volumes === 1 ? "volume" : "volumes"}.`,
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
  const onEdit = () => {
    $("seriesEditError").hidden = true;
    syncControls();
  };
  form.addEventListener(
    "click",
    (event) => {
      if (state.busy || !(event.target instanceof Element)) return;
      const toggle = event.target.closest(".series-edit-toggle");
      const row = rows.find((row) => row.toggle === toggle);
      if (!row) return;
      showDetails(row, row.details.hidden);
      if (!row.details.hidden)
        row.details.firstElementChild?.scrollIntoView({
          block: "nearest",
          inline: "start",
        });
    },
    { signal },
  );
  form.addEventListener("input", onEdit, { signal });
  form.addEventListener("change", onEdit, { signal });
  form.addEventListener(
    "invalid",
    (event) => {
      if (event.target instanceof HTMLElement) {
        const target = event.target;
        const row = rows.find((row) => row.details.contains(target));
        if (row) showDetails(row, true);
      }
    },
    { capture: true, signal },
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
