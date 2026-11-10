import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openTestStore } from "../helpers/database.mjs";
import { createAccount } from "../../lib/server/auth.ts";
import { errorResponse } from "../../lib/server/http.ts";

async function setup(t) {
  const store = await openTestStore();
  t.after(() => store.close());
  for (const volume of [1, 2, 3])
    await store.api.saveBook({
      requestId: randomUUID(),
      book: {
        series: "Conflict fixtures",
        type: "Manga",
        status: "Reading",
        volume,
        note: "Original",
      },
    });
  return store;
}
const save = (store, book, updates) =>
  store.api.saveBook({
    requestId: randomUUID(),
    row: book.row,
    token: book.token,
    book: { ...book, ...updates },
  });

test("admin saves ignore changes to rows outside the attempted edits", async (t) => {
  const store = await setup(t);
  const before = (await store.api.getCollection()).books;
  await save(store, before[2], { note: "Unrelated saved change" });
  await save(store, before[0], { note: "Single edit" });
  await store.api.saveSeriesVolumes({
    requestId: randomUUID(),
    series: before[1].series,
    changes: [
      {
        row: before[1].row,
        token: before[1].token,
        book: { note: "Bulk edit" },
      },
    ],
  });
  assert.deepEqual(
    (await store.api.getCollection()).books.map((book) => book.note),
    ["Single edit", "Bulk edit", "Unrelated saved change"],
  );
});

test("same-row conflicts return current owned values and token without overwriting them", async (t) => {
  const store = await setup(t);
  const before = (await store.api.getCollection()).books[0];
  await save(store, before, { note: "Saved by another editor" });
  const latest = (await store.api.getCollection()).books[0];
  await assert.rejects(
    save(store, before, { note: "My edit" }),
    (asyncError) => {
      assert.equal(asyncError.status, 409);
      assert.deepEqual(asyncError.editConflict, { books: [latest] });
      return true;
    },
  );
  try {
    await save(store, before, { note: "My edit" });
    assert.fail("Expected a conflict");
  } catch (error) {
    const response = errorResponse(error);
    assert.equal(response.status, 409);
    assert.deepEqual((await response.json()).editConflict, { books: [latest] });
  }
  assert.deepEqual((await store.api.getCollection()).books[0], latest);
  await save(store, latest, { note: "My chosen edit" });
  await assert.rejects(save(store, latest, { note: "Stale resolution" }), {
    status: 409,
  });
});

test("bulk conflicts report only attempted stale rows, all at once, and roll back the whole save", async (t) => {
  const store = await setup(t);
  const before = (await store.api.getCollection()).books;
  for (const book of before.slice(0, 2))
    await save(store, book, { note: `Saved ${book.volume}` });
  const latest = (await store.api.getCollection()).books;
  await assert.rejects(
    store.api.saveSeriesVolumes({
      requestId: randomUUID(),
      series: before[0].series,
      changes: before.map((book) => ({
        row: book.row,
        token: book.token,
        book: { source: "Must not save yet" },
      })),
    }),
    (error) => {
      assert.equal(error.status, 409);
      assert.deepEqual(error.editConflict.books, latest.slice(0, 2));
      return true;
    },
  );
  assert.deepEqual((await store.api.getCollection()).books, latest);
});

test("removed rows and another account's rows never expose conflict data or get recreated", async (t) => {
  const store = await setup(t);
  const before = (await store.api.getCollection()).books[0];
  const reader = await createAccount(
    store,
    "conflict-reader",
    "conflict-reader@gmail.com",
  );
  await store.forUser(reader, async () => {
    await assert.rejects(
      save(store, before, { note: "Unauthorized" }),
      (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.editConflict, undefined);
        return true;
      },
    );
  });
  await store.api.removeBook({
    requestId: randomUUID(),
    row: before.row,
    token: before.token,
  });
  await assert.rejects(
    save(store, before, { note: "Do not recreate" }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.editConflict, undefined);
      return true;
    },
  );
  assert.equal((await store.api.getCollection()).books.length, 2);
});
