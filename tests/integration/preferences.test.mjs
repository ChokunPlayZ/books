import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestStore as openStore } from "../helpers/database.mjs";
import {
  createAccount,
  signInWithGoogle,
  sessionUser,
} from "../../lib/server/auth.ts";

test("account preferences are private, survive restart and follow new sessions", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "books-preferences-")),
    "books.sqlite",
  );
  let store = await openStore(path);
  const alice = await createAccount(store, "alice", "alice@gmail.com");
  const bob = await createAccount(store, "bob", "bob@gmail.com");
  await store.forUser(alice, async () => {
    assert.deepEqual(await store.preferences.get(), {
      locale: "en",
      theme: "system",
    });
    await store.preferences.update({ locale: "th", theme: "dark" });
  });
  await store.forUser(bob, async () => {
    assert.deepEqual(await store.preferences.get(), {
      locale: "en",
      theme: "system",
    });
    await store.preferences.update({ theme: "light" });
  });
  await store.close();
  store = await openStore(path);
  try {
    const identity = {
      sub: "alice-google",
      email: "alice@gmail.com",
      email_verified: true,
    };
    for (let device = 0; device < 2; device++) {
      const { token } = await signInWithGoogle(store, identity);
      const user = await sessionUser(store, token);
      await store.forUser(user, async () =>
        assert.deepEqual(await store.preferences.get(), {
          locale: "th",
          theme: "dark",
        }),
      );
    }
    await store.forUser(alice, async () => {
      assert.deepEqual(await store.preferences.update({ theme: "light" }), {
        locale: "th",
        theme: "light",
      });
      assert.deepEqual(await store.preferences.update({ locale: "en" }), {
        locale: "en",
        theme: "light",
      });
    });
    await store.forUser(bob, async () =>
      assert.deepEqual(await store.preferences.get(), {
        locale: "en",
        theme: "light",
      }),
    );
  } finally {
    await store.close();
  }
});

test("preference updates validate all fields before changing anything", async (t) => {
  const store = await openStore();
  t.after(async () => await store.close());
  for (const input of [
    null,
    [],
    {},
    "th",
    { locale: "ja" },
    { theme: "sepia" },
    { locale: ["en"] },
    { theme: null },
    { userId: 2, locale: "th" },
    { locale: "th", theme: "bad" },
  ]) {
    await assert.rejects(async () => await store.preferences.update(input), {
      status: 400,
    });
    assert.deepEqual(await store.preferences.get(), {
      locale: "en",
      theme: "system",
    });
  }
});

test("schema initialization preserves accounts, books and active sessions", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "books-preferences-migration-")),
    "books.sqlite",
  );
  let store = await openStore(path);
  const identity = {
    sub: "owner",
    email: "owner@gmail.com",
    email_verified: true,
  };
  const { token } = await signInWithGoogle(store, identity, identity.email);
  await store.api.saveBook({
    requestId: "migration_preferences_book",
    book: {
      series: "Collection",
      type: "Manga",
      status: "Read",
      volume: 1,
      isbn: "",
      price: "",
      date: "",
      source: "",
      publisher: "",
      note: "Your collection",
    },
  });
  const before = (await store.api.getCollection()).books;
  const latest = (
    await store.db
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get()
  ).version;
  // Recreate the previous schema so reopening exercises the photo migration.
  await store.db.exec("ALTER TABLE users DROP COLUMN picture");
  await store.db.exec("ALTER TABLE users DROP COLUMN disabled");
  await store.db.exec("ALTER TABLE oauth_attempts DROP COLUMN relink_hash");
  await store.db.exec(
    "DROP TABLE series_profiles,admin_events,account_relinks,publisher_request_slots,publisher_crawl_seen,publisher_crawls",
  );
  await store.db.exec("DELETE FROM schema_migrations WHERE version>=4");
  await store.close();
  store = await openStore(path);
  try {
    assert.equal(
      (
        await store.db
          .prepare("SELECT MAX(version) AS version FROM schema_migrations")
          .get()
      ).version,
      latest,
    );
    assert.equal((await store.account.get()).picture, null);
    assert.ok(await sessionUser(store, token));
    assert.deepEqual((await store.api.getCollection()).books, before);
    assert.deepEqual(await store.preferences.get(), {
      locale: "en",
      theme: "system",
    });
  } finally {
    await store.close();
  }
});
