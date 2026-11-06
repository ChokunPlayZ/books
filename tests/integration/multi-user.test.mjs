import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openTestStore as openStore } from "../helpers/database.mjs";
import {
  createAccount,
  signInWithGoogle,
  sessionUser,
  signOut,
} from "../../lib/server/auth.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import { parseImport } from "../../lib/server/importer.ts";
import { releaseItem } from "../../lib/domain.ts";

const input = {
  isbn: "9786166247275",
  series: "My private title",
  type: "Manga (TH) (Color)",
  publisher: "Phoenix Next",
  status: "Reading",
  volume: 1,
  source: "Private shop",
  price: 110,
  date: "2026-11-01",
  note: "Private gift note",
  msrp: 175,
  msrpCurrency: "THB",
};
async function setup(t) {
  const store = await openStore();
  t.after(async () => await store.close());
  const alice = await createAccount(store, "alice", "alice@gmail.com");
  const bob = await createAccount(store, "bob", "bob@gmail.com");
  return {
    store,
    alice,
    bob,
    as: async (user, action) => await store.forUser(user, action),
  };
}
const save = async (store, book = input, requestId = randomUUID()) =>
  await store.api.saveBook({ requestId, book });

test("collections, options, ownership, receipts, saved releases and catalog choices are user-private", async (t) => {
  const { store, alice, bob, as } = await setup(t);
  const requestId = randomUUID();
  let original;
  await as(alice, async () => {
    await save(store, input, requestId);
    const release = releaseItem(
      "phoenix",
      "Example เล่ม 2",
      "https://www.phoenixnext.com/example.html",
      175,
      "",
      "Manga (TH)",
    );
    await store.api.setSavedRelease({ saved: true, release });
    await store.api.setSeriesCatalog({
      series: input.series,
      type: input.type,
      publisherId: "phoenix",
      url: "https://www.phoenixnext.com/book-series/private.html",
    });
    original = (await store.api.getCollection()).books[0];
    assert.equal(original.type, "Manga");
    assert.equal(original.edition, input.type);
    assert.equal(original.msrp, 175);
    assert.deepEqual((await store.api.getCollection()).options.type, [
      "Light novel",
      "Manga",
      "Others",
    ]);
  });
  await as(bob, async () => {
    const empty = await store.api.getCollection();
    assert.deepEqual(
      [
        empty.books.length,
        empty.trash.length,
        empty.savedReleases.length,
        empty.seriesCatalogs.length,
      ],
      [0, 0, 0, 0],
    );
    assert.deepEqual(empty.options.source, []);
    assert.equal(
      (await store.api.checkOwnership(input.isbn)).matches.length,
      0,
    );
    await save(
      store,
      { ...input, source: "Bob's shop", note: "Bob's note" },
      requestId,
    );
    assert.equal(
      (await store.api.getCollection()).books[0].source,
      "Bob's shop",
    );
    assert.notEqual(
      (await store.api.getCollection()).books[0].row,
      original.row,
    );
    await assert.rejects(
      async () =>
        await store.api.saveBook({
          row: original.row,
          token: original.token,
          requestId: randomUUID(),
          book: input,
        }),
      { status: 409 },
    );
    await assert.rejects(
      async () =>
        await store.api.removeBook({ ...original, requestId: randomUUID() }),
      { status: 409 },
    );
    await assert.rejects(
      async () =>
        await store.api.saveSeriesPurchases({
          series: input.series,
          requestId: randomUUID(),
          changes: [{ ...original, source: "Stolen", price: "1", date: "" }],
        }),
      { status: 409 },
    );
  });
  let removed;
  await as(alice, async () => {
    removed = await store.api.removeBook({
      ...original,
      requestId: randomUUID(),
    });
  });
  await as(bob, async () => {
    await assert.rejects(
      async () =>
        await store.api.restoreBook({
          trashId: removed.trashId,
          requestId: randomUUID(),
        }),
      { status: 409 },
    );
    await assert.rejects(
      async () =>
        await store.api.updateBooks({
          action: "restore",
          requestId: randomUUID(),
          books: [{ ...original, trashId: removed.trashId }],
        }),
      { status: 409 },
    );
    const backup = JSON.stringify(await store.exportData());
    assert.ok(!backup.includes("Private gift note"));
    assert.equal((await store.api.getCollection()).trash.length, 0);
  });
  await as(alice, async () => {
    assert.equal(
      (await store.api.getCollection()).trash[0].book.note,
      input.note,
    );
    assert.equal(
      (await store.api.getCollection()).options.source.includes("Bob's shop"),
      false,
    );
  });
});

test("async requests keep their identities, and imports and image exports are scoped", async (t) => {
  const { store, alice, bob, as } = await setup(t);
  const plan = parseImport(Buffer.from(JSON.stringify([input])), "books.json");
  await Promise.all(
    [alice, bob].map(
      async (user) =>
        await as(user, async () => {
          await Promise.resolve();
          assert.equal(store.currentUser().id, user.id);
          assert.equal(
            (await store.importData(plan, plan.fingerprint)).books,
            1,
          );
          assert.equal((await store.api.getCollection()).books.length, 1);
        }),
    ),
  );
  let privateCover;
  await as(alice, async () => {
    privateCover = await store.covers.put({
      body: Buffer.from("private-image"),
      contentType: "image/png",
    });
    const book = (await store.api.getCollection()).books[0];
    await store.covers.assign(book.row, privateCover.id, book.token);
    assert.equal((await store.exportData()).covers[0].id, privateCover.id);
  });
  await as(bob, async () => {
    assert.equal(await store.covers.canAccess(privateCover.id), false);
    assert.deepEqual((await store.exportData()).covers, []);
    const book = (await store.api.getCollection()).books[0];
    await assert.rejects(
      async () =>
        await store.api.saveBook({
          ...book,
          requestId: randomUUID(),
          book: { ...book, coverId: privateCover.id },
        }),
      /available stored cover/,
    );
  });
});

test("user sessions identify accounts and ordinary users cannot inspect caches or force scraping", async (t) => {
  const { store, alice, bob, as } = await setup(t);
  const signedIn = await signInWithGoogle(store, {
    sub: "alice-google",
    email: "alice@gmail.com",
    email_verified: true,
  });
  assert.equal((await sessionUser(store, signedIn.token)).id, alice.id);
  await assert.rejects(
    async () =>
      await signInWithGoogle(store, {
        sub: "bob-google",
        email: "alice@gmail.com",
        email_verified: true,
      }),
    { status: 403 },
  );
  await signOut(store, signedIn.token);
  assert.equal(await sessionUser(store, signedIn.token), null);
  const api = createApplicationApi(
    store,
    {
      ensure() {
        assert.fail("No image request expected");
      },
    },
    () => assert.fail("No source request expected"),
  );
  await as(bob, async () => {
    for (const name of [
      "getMetadataOverview",
      "getMetadataCacheEntry",
      "purgeMetadataCache",
      "recrawlMetadata",
    ])
      await assert.rejects(async () => api[name]({}), { status: 403 });
    await assert.rejects(api.lookupIsbn({ isbn: input.isbn, refresh: true }), {
      status: 403,
    });
    await assert.rejects(
      api.findLowestPrices({ isbn: input.isbn, refresh: true }),
      { status: 403 },
    );
    await assert.rejects(
      async () =>
        await createAccount(store, "mallory", "mallory@gmail.com", "admin"),
      { status: 403 },
    );
  });
});

test("unverified Google identities cannot claim a library or affect another account", async (t) => {
  const { store } = await setup(t);
  for (let count = 0; count < 10; count++)
    await assert.rejects(
      async () =>
        await signInWithGoogle(store, {
          sub: "mallory",
          email: "alice@gmail.com",
          email_verified: false,
        }),
      { status: 403 },
    );
  const bob = await signInWithGoogle(store, {
    sub: "bob-google",
    email: "bob@gmail.com",
    email_verified: true,
  });
  assert.equal((await sessionUser(store, bob.token)).username, "bob");
  assert.equal(
    (
      await store.db
        .prepare("SELECT google_subject FROM users WHERE username='alice'")
        .get()
    ).google_subject,
    null,
  );
});

test("imported cover/source associations cannot overwrite shared publisher images", async (t) => {
  const { store, alice, bob, as } = await setup(t);
  const url =
    "https://www.phoenixnext.com/media/catalog/product/private-import.png";
  await as(alice, async () => {
    await store.importData(
      {
        books: [],
        trash: [],
        savedReleases: [],
        seriesCatalogs: [],
        options: {},
        warnings: [],
        covers: [
          {
            body: Buffer.from("Alice private cover"),
            contentType: "image/png",
            sources: [url],
          },
        ],
      },
      "private-image-import",
    );
    assert.ok(await store.covers.bySource(url));
  });
  await as(bob, async () => {
    assert.equal(await store.covers.bySource(url), null);
    assert.deepEqual((await store.exportData()).covers, []);
  });
  assert.equal(
    (
      await store.db
        .prepare("SELECT COUNT(*) AS n FROM cover_sources WHERE url=?")
        .get(url)
    ).n,
    0,
  );
});
