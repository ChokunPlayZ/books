import {
  BOOK_EDIT_LABELS,
  BookEditConflictError,
  bookEditDiff,
  resolvedBookEdit,
  type BookEditField,
  type BookEditRequest,
} from "../book-edit-conflicts.ts";
import type { StoredBook } from "../types.ts";
import { node, requestId } from "./dom.ts";
import { t } from "./i18n.ts";

type Review = {
  current: StoredBook;
  diffs: ReturnType<typeof bookEditDiff>;
};
type Choices = Partial<Record<BookEditField, "mine" | "latest">>;

function pickConflictValues(reviews: Review[], signal: AbortSignal) {
  return new Promise<Map<number, Choices> | null>((resolve) => {
    if (signal.aborted) return resolve(null);
    const dialog = node("dialog", "book-edit-conflict");
    dialog.setAttribute("aria-labelledby", "bookEditConflictTitle");
    dialog.setAttribute("aria-describedby", "bookEditConflictHint");
    const form = node("form");
    const heading = node("div", "dialog-head");
    const title = node("h2", "", t("Resolve edit conflict"));
    title.id = "bookEditConflictTitle";
    title.tabIndex = -1;
    heading.append(title);
    const body = node("div", "dialog-body");
    const hint = node(
      "p",
      "hint",
      t(
        "These rows changed while you were editing. Compare the original, latest saved and your values, then choose what to keep. Nothing is saved until you confirm.",
      ),
    );
    hint.id = "bookEditConflictHint";
    body.append(hint);
    const selections: {
      row: number;
      field: BookEditField;
      mine: HTMLInputElement;
    }[] = [];
    for (const { current, diffs } of reviews) {
      const section = node("section", "book-conflict-row");
      section.dataset.row = String(current.row);
      section.append(
        node(
          "h3",
          "",
          `${current.series} · ${current.volume === "" ? t("Unnumbered") : t("Volume {volume}", { volume: current.volume })}`,
        ),
      );
      for (const diff of diffs) {
        const field = node("fieldset", "book-conflict-field");
        field.dataset.field = diff.field;
        field.append(
          node("legend", "", t(BOOK_EDIT_LABELS[diff.field])),
          node(
            "p",
            "book-conflict-original",
            t("Original value: {value}", {
              value: String(diff.before ?? "") || t("Not provided"),
            }),
          ),
        );
        const options = node("div", "book-conflict-options");
        for (const choice of ["latest", "mine"] as const) {
          const label = node("label", "book-conflict-option");
          const input = node("input");
          input.type = "radio";
          input.name = `conflict-${current.row}-${diff.field}`;
          input.value = choice;
          input.required = true;
          // Non-overlapping changes have safe defaults. Competing edits require
          // an explicit selection rather than silently replacing either value.
          input.checked =
            !diff.different || !(diff.changed && diff.edited)
              ? choice === (diff.edited ? "mine" : "latest")
              : false;
          const copy = node("span");
          copy.append(
            node(
              "strong",
              "",
              t(choice === "mine" ? "Your value" : "Latest saved value"),
            ),
            node(
              "span",
              "book-conflict-value",
              String((choice === "mine" ? diff.mine : diff.latest) ?? "") ||
                t("Not provided"),
            ),
          );
          label.append(input, copy);
          options.append(label);
          if (choice === "mine")
            selections.push({
              row: current.row,
              field: diff.field,
              mine: input,
            });
        }
        field.append(options);
        section.append(field);
      }
      body.append(section);
    }
    const buttons = node("div", "buttons book-conflict-actions");
    const cancel = node("button", "btn", t("Back to editing"));
    cancel.type = "button";
    const save = node("button", "btn primary", t("Save selected values"));
    save.type = "submit";
    buttons.append(cancel, save);
    form.append(heading, body, buttons);
    dialog.append(form);
    const previousFocus = document.activeElement;
    function finish(result: Map<number, Choices> | null) {
      signal.removeEventListener("abort", abort);
      dialog.close();
      dialog.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
      resolve(result);
    }
    const abort = () => finish(null);
    signal.addEventListener("abort", abort, { once: true });
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = new Map<number, Choices>();
      for (const { row, field, mine } of selections) {
        const choices = result.get(row) ?? {};
        choices[field] = mine.checked ? "mine" : "latest";
        result.set(row, choices);
      }
      finish(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    title.focus();
  });
}

export async function saveBookEdits<T>(
  name: "saveBook" | "saveSeriesVolumes",
  request: BookEditRequest,
  originals: StoredBook[],
  rpc: (name: string, arg: unknown) => Promise<T>,
  signal: AbortSignal,
): Promise<T | null> {
  while (!signal.aborted) {
    try {
      return await rpc(name, request);
    } catch (error) {
      if (!(error instanceof BookEditConflictError)) throw error;
      const edits = request.changes ?? [
        { row: request.row!, token: request.token!, book: request.book! },
      ];
      const reviews = error.books.map((current) => {
        const original = originals.find((book) => book.row === current.row);
        const edit = edits.find((edit) => edit.row === current.row);
        if (!original || !edit) throw error;
        return { current, diffs: bookEditDiff(original, current, edit.book) };
      });
      if (!reviews.length) throw error;
      const changed = reviews.filter(({ diffs }) =>
        diffs.some((diff) => diff.changed),
      );
      const choices = changed.length
        ? await pickConflictValues(changed, signal)
        : new Map<number, Choices>();
      if (choices === null || signal.aborted) return null;
      for (const { current, diffs } of reviews) {
        const edit = edits.find((edit) => edit.row === current.row)!;
        edit.token = current.token;
        edit.book = resolvedBookEdit(current, diffs, choices.get(current.row));
        originals[originals.findIndex((book) => book.row === current.row)] =
          current;
      }
      if (!request.changes) {
        request.token = edits[0].token;
        request.book = edits[0].book;
      }
      // A rejected save has no receipt. New content gets a new receipt ID; an
      // uncertain network retry retains this exact request and these choices.
      request.requestId = requestId();
    }
  }
  return null;
}
