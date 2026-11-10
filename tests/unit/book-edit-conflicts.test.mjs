import test from "node:test";
import assert from "node:assert/strict";
import {
  BookEditConflictError,
  bookEditDiff,
  resolvedBookEdit,
} from "../../lib/book-edit-conflicts.ts";
import { saveBookEdits } from "../../lib/client/book-edit-conflicts.ts";

const original = {
  row: 1,
  token: "original-token",
  series: "A story",
  type: "Manga",
  publisher: "Test press",
  isbn: "",
  status: "Reading",
  volume: 1,
  price: 0,
  date: "",
  source: "Old shop",
  note: "Original note",
  coverUrl: "",
  publisherUrl: "",
};

test("book diffs ignore revision tokens, derived previews and equivalent numeric form values", () => {
  const latest = {
    ...original,
    token: "new-token",
    coverBlurhash: "preview-only",
    pageCount: "",
  };
  assert.deepEqual(
    bookEditDiff(original, latest, {
      volume: "1.00",
      price: "0.00",
      pageCount: "",
    }),
    [],
  );
  assert.equal(bookEditDiff(original, latest, { price: "" })[0].edited, true);
});

test("three-way diffs distinguish user edits, saved edits and overlapping edits", () => {
  const latest = { ...original, note: "Saved note", source: "Saved shop" };
  const diffs = bookEditDiff(original, latest, {
    note: "My note",
    price: "25",
    source: original.source,
  });
  assert.deepEqual(
    diffs.map(({ field, edited, changed }) => ({ field, edited, changed })),
    [
      { field: "source", edited: false, changed: true },
      { field: "price", edited: true, changed: false },
      { field: "note", edited: true, changed: true },
    ],
  );
  const keepLatest = resolvedBookEdit(latest, diffs, { note: "latest" });
  assert.equal(keepLatest.source, "Saved shop");
  assert.equal(keepLatest.price, "25");
  assert.equal(keepLatest.note, "Saved note");
  const keepMine = resolvedBookEdit(latest, diffs, { note: "mine" });
  assert.equal(keepMine.note, "My note");
  assert.equal(keepMine.source, "Saved shop");
  assert.equal(keepMine.row, undefined);
  assert.equal(keepMine.token, undefined);
});

test("partial volume edits preserve remotely changed metadata, blank values and gifts", () => {
  const latest = { ...original, pageCount: 250, price: 100, note: "" };
  const diffs = bookEditDiff(original, latest, { status: "Read", price: "0" });
  const resolved = resolvedBookEdit(latest, diffs, { price: "mine" });
  assert.equal(resolved.status, "Read");
  assert.equal(resolved.pageCount, 250);
  assert.equal(resolved.note, "");
  assert.equal(resolved.price, "0");
});

test("revision-only conflicts automatically retry the affected row with its latest token", async (t) => {
  const previous = globalThis.window;
  globalThis.window = { crypto: globalThis.crypto };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  const latest = { ...original, token: "latest-token" };
  const request = {
    requestId: "initial-request",
    changes: [{ row: 1, token: original.token, book: { note: "My note" } }],
  };
  const originals = [{ ...original }];
  let attempts = 0;
  const result = await saveBookEdits(
    "saveSeriesVolumes",
    request,
    originals,
    async (_name, arg) => {
      if (++attempts === 1)
        throw new BookEditConflictError("Changed", [latest]);
      assert.equal(arg.changes[0].token, latest.token);
      assert.equal(arg.changes[0].book.note, "My note");
      assert.notEqual(arg.requestId, "initial-request");
      return { volumes: 1 };
    },
    new AbortController().signal,
  );
  assert.deepEqual(result, { volumes: 1 });
  assert.deepEqual(originals, [latest]);
  assert.equal(attempts, 2);
});

test("unrelated errors and conflicts outside the attempted rows never retry", async () => {
  const request = {
    requestId: "test",
    row: 1,
    token: original.token,
    book: { note: "Mine" },
  };
  for (const error of [
    new Error("Duplicate ISBN"),
    new BookEditConflictError("Other row", [{ ...original, row: 2 }]),
  ]) {
    let attempts = 0;
    await assert.rejects(
      saveBookEdits(
        "saveBook",
        request,
        [original],
        async () => {
          attempts++;
          throw error;
        },
        new AbortController().signal,
      ),
      (caught) => caught === error,
    );
    assert.equal(attempts, 1);
  }
});
