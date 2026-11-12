import { $, node, icon, requestId, fillOptions, number } from "./dom.ts";
import { t } from "./i18n.ts";
import { bookSourceApplies } from "../domain/book-sources.ts";
import { publisherKey } from "./matching.ts";
import type { CollectionState } from "./state.ts";
import type { StoredBook } from "../types.ts";
import { saveBookEdits } from "./book-edit-conflicts.ts";

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
  edition: "Edition details",
  msrp: "MSRP / list price",
  msrpCurrency: "MSRP currency",
};
type Field = keyof typeof labels;
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type EditRow = {
  book: StoredBook;
  element: HTMLTableRowElement;
  details: HTMLDivElement;
  toggle: HTMLButtonElement;
  heading: HTMLElement;
  metadata: HTMLElement;
  inputs: Record<Field, Control>;
  summaries: Partial<Record<Field, HTMLElement>>;
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
  let editing: EditRow | null = null;
  let pending: {
    key: string;
    originals: StoredBook[];
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
    if (["price", "volume", "pageCount", "msrp"].includes(field))
      return (
        input.validity.badInput ||
        (value === ""
          ? row.book[field] != null && row.book[field] !== ""
          : row.book[field] === "" || Number(value) !== row.book[field])
      );
    return value !== String(row.book[field] ?? "");
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
    $("saveSeriesEdits").textContent = t(
      state.busy ? "Saving…" : "Save changes",
    );
    $("cancelSeriesEdit").disabled = state.busy;
    $("cancelSeriesEdit").textContent = t(count ? "Discard changes" : "Done");
    $("seriesSaveStatus").textContent = state.busy
      ? t("Saving your changes…")
      : count
        ? t("Unsaved changes · {count} volumes", { count })
        : t("No unsaved changes");
    $("seriesSaveHint").textContent = t(
      count
        ? "Save your changes before leaving this page."
        : "Your edits stay here until you save.",
    );
    $("seriesSaveBar").classList.toggle("is-dirty", count > 0);
    for (const row of rows) {
      row.element.classList.toggle("is-dirty", changed(row));
      row.toggle.disabled = state.busy;
      const volume = row.inputs.volume.value.trim();
      row.heading.textContent =
        volume === "" ? t("Unnumbered") : t("Volume {volume}", { volume });
      row.metadata.textContent = [
        row.inputs.type.value,
        row.inputs.publisher.value.trim(),
        row.inputs.edition.value.trim(),
      ]
        .filter(Boolean)
        .join(" · ");
      row.toggle.setAttribute(
        "aria-label",
        t("Edit {volume}", {
          volume: row.heading.textContent,
        }),
      );
      for (const field of ["status", "date", "price", "source"] as const) {
        const value = row.inputs[field].value.trim();
        row.summaries[field]!.textContent =
          value === ""
            ? t("Not recorded")
            : field === "price"
              ? "฿" + number(Number(value))
              : field === "status"
                ? t(value)
                : value;
      }
      for (const input of Object.values(row.inputs))
        input.disabled = state.busy;
    }
    $("resetSeriesVolume").disabled = !editing || !changed(editing);
  }

  function showDetails(row: EditRow) {
    if (state.busy) return;
    for (const item of rows) {
      item.details.hidden = item !== row;
      item.toggle.setAttribute("aria-expanded", String(item === row));
    }
    editing = row;
    $("seriesVolumeTitle").textContent = row.heading.textContent;
    $("seriesVolumeSubtitle").textContent = state.selectedSeries;
    syncViewport();
    $("seriesVolumeDialog").showModal();
    $("seriesVolumeFields").scrollTop = 0;
    $("seriesVolumeTitle").focus();
    syncControls();
  }

  function syncViewport() {
    const viewport = window.visualViewport;
    $("seriesVolumeDialog").style.setProperty(
      "--volume-dialog-height",
      (viewport?.height ?? window.innerHeight) + "px",
    );
    $("seriesVolumeDialog").style.setProperty(
      "--volume-dialog-top",
      (viewport?.offsetTop ?? 0) + "px",
    );
  }

  function closeDetails() {
    $("seriesVolumeDialog").close();
    if (editing) {
      editing.toggle.setAttribute("aria-expanded", "false");
      editing.toggle.focus();
    }
    editing = null;
  }

  function editField(
    book: StoredBook,
    field: Field,
    inputs: EditRow["inputs"],
  ) {
    if (
      state.data?.user.role !== "admin" &&
      [
        "pageCount",
        "coverUrl",
        "publisherUrl",
        "msrp",
        "msrpCurrency",
      ].includes(field)
    ) {
      const input = node("input");
      input.readOnly = true;
      input.id = `volume-${book.row}-${field}`;
      input.name = field;
      input.value = String(book[field] ?? "");
      inputs[field] = input;
      const wrapper = node("div", "field");
      const label = node("label", "", t(labels[field]));
      label.htmlFor = input.id;
      input.placeholder = t("Not recorded");
      wrapper.append(label, input);
      return wrapper;
    }
    const wrapper = node("div", "field");
    const label = node("label", "", t(labels[field]));
    const id = `volume-${book.row}-${field}`;
    label.htmlFor = id;
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
          t(value || (field === "type" ? "Choose a type" : "Choose a status")),
        );
        option.value = value;
        input.append(option);
      }
      input.required = true;
    } else if (field === "note") {
      input = node("textarea");
      input.rows = 2;
      input.maxLength = 2000;
      wrapper.classList.add("span-2");
    } else {
      input = node("input");
      input.type = ["volume", "price", "pageCount", "msrp"].includes(field)
        ? "number"
        : field === "date"
          ? "date"
          : field.endsWith("Url")
            ? "url"
            : "text";
      input.maxLength = field.endsWith("Url") ? 2000 : 500;
      if (field === "volume" || field === "price" || field === "msrp") {
        input.min = "0";
        input.step = "any";
        input.inputMode = "decimal";
        input.placeholder = t(
          field === "volume" ? "Unnumbered" : "Not recorded",
        );
      } else if (field === "pageCount") {
        input.min = "1";
        input.step = "1";
        input.inputMode = "numeric";
        input.placeholder = t("Not recorded");
      } else if (field === "date") {
        input.min = "1900-01-01";
        input.max = "9999-12-31";
      } else if (field === "publisher" || field === "source") {
        input.setAttribute("list", field + "Options");
        if (field === "publisher") {
          const updatePublisherSuggestions = () => {
            delete $("publisherOptions").dataset.context;
            fillOptions(
              "publisherOptions",
              state.data!.options.publisher.filter((name) =>
                bookSourceApplies(publisherKey(name), {
                  isbn: inputs.isbn.value,
                  type: inputs.type.value,
                }),
              ),
            );
          };
          input.addEventListener("focus", updatePublisherSuggestions, {
            signal,
          });
          inputs.type.addEventListener("change", updatePublisherSuggestions, {
            signal,
          });
          inputs.isbn.addEventListener("input", updatePublisherSuggestions, {
            signal,
          });
        }
        input.placeholder =
          field === "source"
            ? t("Store or seller")
            : t("Choose or enter a publisher");
      } else if (field === "isbn") {
        input.placeholder = "978… or ISBN-10";
        input.maxLength = 40;
      } else if (field.endsWith("Url")) {
        input.placeholder = "https://…";
      } else if (field === "msrpCurrency") {
        input.maxLength = 3;
        input.placeholder = "THB, USD, JPY";
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
          book.volume === ""
            ? t("Unnumbered volume")
            : t("Volume {volume}", { volume: book.volume });
        const toggle = node("button", "series-edit-toggle");
        toggle.type = "button";
        toggle.setAttribute("aria-controls", "seriesVolumeDialog");
        toggle.setAttribute("aria-haspopup", "dialog");
        toggle.setAttribute("aria-expanded", "false");
        const title = node("strong", "", volume);
        title.id = `volume-${book.row}-title`;
        const metadata = node(
          "span",
          "hint",
          [book.type, book.publisher, book.isbn].filter(Boolean).join(" · "),
        );
        const editIcon = icon("edit");
        toggle.append(title, editIcon);
        headingCell.append(toggle, metadata);
        element.append(headingCell);
        const inputs = {} as EditRow["inputs"];
        const summaries: EditRow["summaries"] = {};
        for (const field of ["status", "date", "price", "source"] as const) {
          const cell = node("td");
          cell.dataset.label = t(labels[field]);
          const value = node("span");
          summaries[field] = value;
          cell.append(value);
          element.append(cell);
        }
        const details = node("div", "series-edit-details-body");
        details.id = `volume-${book.row}-details`;
        details.hidden = true;
        for (const [heading, fields] of [
          [
            "Edition & publication",
            ["volume", "isbn", "type", "publisher", "edition"],
          ],
          [
            "Your copy & purchase",
            ["status", "date", "price", "source", "note"],
          ],
          [
            "Book metadata",
            ["msrp", "msrpCurrency", "pageCount", "coverUrl", "publisherUrl"],
          ],
        ] as [string, Field[]][]) {
          const section = node("fieldset", "volume-editor-section");
          section.append(node("legend", "", t(heading)));
          const grid = node("div", "volume-editor-grid");
          for (const field of fields)
            grid.append(editField(book, field, inputs));
          section.append(grid);
          details.append(section);
        }
        const row = {
          book: { ...book },
          element,
          details,
          toggle,
          heading: title,
          metadata,
          inputs,
          summaries,
        };
        return row;
      });
    $("seriesEditRows").replaceChildren(...rows.map((row) => row.element));
    $("seriesVolumeFields").replaceChildren(...rows.map((row) => row.details));
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
    closeDetails();
    active = false;
    rows = [];
    pending = null;
    form.hidden = true;
    $("seriesEditRows").replaceChildren();
    $("seriesVolumeFields").replaceChildren();
    $("libraryMain").classList.remove("series-editing");
    $("editVolumesButton").setAttribute("aria-expanded", "false");
    syncControls();
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (state.busy || !active) return;
    for (const row of rows) {
      const invalid = Object.values(row.inputs).find(
        (input) => !input.validity.valid,
      );
      if (invalid) {
        showDetails(row);
        invalid.reportValidity();
        return;
      }
    }
    const edits = changes();
    if (!edits.length) return;
    const content = { series: state.selectedSeries!, changes: edits };
    const key = JSON.stringify(content);
    if (pending?.key !== key)
      pending = {
        key,
        request: { ...content, requestId: requestId() },
        originals: rows.filter(changed).map((row) => ({ ...row.book })),
      };
    $("seriesEditError").hidden = true;
    setBusy(true);
    form.setAttribute("aria-busy", "true");
    try {
      const result = await saveBookEdits(
        "saveSeriesVolumes",
        pending.request,
        pending.originals,
        rpc,
        signal,
      );
      if (!result) return;
      close();
      notify(
        t("Details saved for {count} volumes.", { count: result.volumes }),
      );
      try {
        await reload();
      } catch {
        $("pageError").textContent = t(
          "Your changes were saved, but the list could not refresh. Press Refresh to see them.",
        );
        $("pageError").hidden = false;
      }
    } catch (error) {
      $("seriesEditError").textContent = t(
        error instanceof Error ? error.message : String(error),
      );
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
      const element = event.target.closest(".series-edit-volume");
      const row = rows.find((row) => row.element === element);
      if (!row) return;
      showDetails(row);
    },
    { signal },
  );
  form.addEventListener("input", onEdit, { signal });
  form.addEventListener("change", onEdit, { signal });
  for (const id of ["closeSeriesVolume", "doneSeriesVolume"] as const)
    $(id).addEventListener("click", closeDetails, { signal });
  $("seriesVolumeDialog").addEventListener(
    "cancel",
    (event) => {
      event.preventDefault();
      closeDetails();
    },
    { signal },
  );
  $("seriesVolumeDialog").addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter" &&
        !event.defaultPrevented &&
        event.target instanceof HTMLInputElement &&
        event.target.getAttribute("aria-expanded") !== "true"
      ) {
        event.preventDefault();
        closeDetails();
      }
    },
    { signal },
  );
  $("resetSeriesVolume").addEventListener(
    "click",
    () => {
      if (!editing) return;
      for (const field of Object.keys(labels) as Field[])
        editing.inputs[field].value = String(editing.book[field] ?? "");
      onEdit();
    },
    { signal },
  );
  form.addEventListener("submit", (event) => void save(event), { signal });
  window.visualViewport?.addEventListener("resize", syncViewport, { signal });
  window.visualViewport?.addEventListener("scroll", syncViewport, { signal });
  window.addEventListener("resize", syncViewport, { signal });
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
