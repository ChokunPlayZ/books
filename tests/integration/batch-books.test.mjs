import test from "node:test";
import assert from "node:assert/strict";
import { createTestLibrary } from "../helpers/library.mjs";

const base = {
  isbn: "0140328726",
  series: "Batch",
  type: "Manga (TH)",
  publisher: "Press",
  status: "Sealed",
  volume: 1,
  source: "Shop",
  price: 125,
  date: "2026-10-01",
  note: "Keep me",
};
const books = [
  base,
  { ...base, volume: 2 },
  { ...base, isbn: "", series: "Other" },
];

test("batch statuses preserve every other field and duplicate copies; retries are idempotent", () => {
  const library = createTestLibrary(books);
  try {
    const before = library.api.getCollection().books;
    const request = {
      requestId: "batch_status_request_1",
      action: "status",
      status: "Read",
      books: before.slice(0, 2).map(({ row, token }) => ({ row, token })),
    };
    assert.deepEqual(library.api.updateBooks(request), {
      books: 2,
      action: "status",
      status: "Read",
    });
    assert.deepEqual(library.api.updateBooks(request), {
      books: 2,
      action: "status",
      status: "Read",
    });
    const after = library.api.getCollection().books;
    for (let i = 0; i < 2; i++) {
      assert.equal(after[i].status, "Read");
      for (const field of Object.keys(before[i]).filter(
        (field) => !["status", "token"].includes(field),
      ))
        assert.deepEqual(after[i][field], before[i][field]);
      assert.notEqual(after[i].token, before[i].token);
    }
    assert.deepEqual(after[2], before[2]);
    assert.throws(
      () => library.api.updateBooks({ ...request, status: "Reading" }),
      /different change/,
    );
  } finally {
    library.close();
  }
});

test("batch status/removal rolls back all books on stale records, repeats and invalid input", () => {
  const library = createTestLibrary(books);
  try {
    const before = library.api.getCollection().books;
    let sequence = 0;
    for (const action of ["status", "remove"]) {
      const request = {
        requestId: `batch_stale_request_${++sequence}`,
        action,
        status: "Read",
        books: [
          { row: before[0].row, token: before[0].token },
          { row: before[1].row, token: "stale" },
        ],
      };
      assert.throws(() => library.api.updateBooks(request), /changed/);
      assert.deepEqual(library.api.getCollection().books, before);
      assert.equal(library.api.getCollection().trash.length, 0);
      assert.throws(
        () =>
          library.api.updateBooks({
            ...request,
            books: [before[0], before[0]],
          }),
        /only once/,
      );
      assert.deepEqual(library.api.getCollection().books, before);
    }
    for (const extra of [
      { action: "bad" },
      { books: [] },
      { status: "" },
      { status: "a".repeat(501) },
      { books: [null] },
    ])
      assert.throws(() =>
        library.api.updateBooks({
          requestId: `batch_invalid_request_${++sequence}`,
          action: "status",
          status: "Read",
          books: before,
          ...extra,
        }),
      );
  } finally {
    library.close();
  }
});

test("batch removal/restore preserves IDs and checks both removed identity and revision atomically", () => {
  const library = createTestLibrary(books);
  try {
    const before = library.api.getCollection().books;
    const remove = {
      requestId: "batch_remove_request_1",
      action: "remove",
      books: before,
    };
    assert.deepEqual(library.api.updateBooks(remove), {
      books: 3,
      action: "remove",
    });
    assert.deepEqual(library.api.updateBooks(remove), {
      books: 3,
      action: "remove",
    });
    const trash = library.api.getCollection().trash;
    const restored = trash.map(({ id, book }) => ({
      row: book.row,
      token: book.token,
      trashId: id,
    }));
    const request = {
      requestId: "batch_restore_request_1",
      action: "restore",
      books: restored,
    };
    assert.throws(
      () =>
        library.api.updateBooks({
          ...request,
          books: [restored[0], { ...restored[1], token: "stale" }],
        }),
      /changed/,
    );
    assert.equal(library.api.getCollection().trash.length, 3);
    assert.throws(
      () =>
        library.api.updateBooks({
          ...request,
          books: [{ ...restored[0], trashId: restored[1].trashId }],
        }),
      /changed/,
    );
    assert.deepEqual(library.api.updateBooks(request), {
      books: 3,
      action: "restore",
    });
    assert.deepEqual(library.api.updateBooks(request), {
      books: 3,
      action: "restore",
    });
    const after = library.api.getCollection().books;
    assert.equal(library.api.getCollection().trash.length, 0);
    assert.deepEqual(
      after.map(({ token, ...book }) => book),
      before.map(({ token, ...book }) => book),
    );
  } finally {
    library.close();
  }
});
