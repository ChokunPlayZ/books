import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openTestStore as openStore } from "../helpers/database.mjs";
import {
  createAccount,
  sessionUser,
  signInWithGoogle,
} from "../../lib/server/auth.ts";

test("session roles and Google credential bindings are revalidated against the database", async (t) => {
  const store = await openStore();
  t.after(() => store.close());
  const identity = {
    sub: "audit-session-reader",
    email: "reader@gmail.com",
    email_verified: true,
  };
  const login = await signInWithGoogle(store, identity);
  assert.equal((await sessionUser(store, login.token)).role, "user");
  await store.db
    .prepare("UPDATE users SET role='admin' WHERE id=?")
    .run(login.user.id);
  assert.equal((await sessionUser(store, login.token)).role, "admin");
  await store.db
    .prepare("UPDATE users SET role='user' WHERE id=?")
    .run(login.user.id);
  assert.equal((await sessionUser(store, login.token)).role, "user");
  await store.db
    .prepare("UPDATE users SET google_subject=? WHERE id=?")
    .run("replacement-google-subject", login.user.id);
  assert.equal(await sessionUser(store, login.token), null);
});

test("caller-supplied roles and SQL-shaped book values cannot change tenant or admin boundaries", async (t) => {
  const store = await openStore();
  t.after(() => store.close());
  const alice = await createAccount(store, "alice", "alice@gmail.com");
  const bob = await createAccount(store, "bob", "bob@gmail.com");
  const series = "Private'; UPDATE users SET role='admin'; -- app_user_id()?";
  let book;
  await store.forUser(alice, async () => {
    await store.api.saveBook({
      requestId: randomUUID(),
      book: { series, type: "Manga", status: "Read" },
    });
    book = (await store.api.getCollection()).books[0];
    assert.equal(book.series, series);
  });
  await store.forUser({ ...bob, role: "admin" }, async () => {
    assert.equal(store.currentUser().role, "user");
    assert.throws(() => store.requireAdmin(), { status: 403 });
    assert.deepEqual((await store.api.getCollection()).books, []);
    await assert.rejects(
      store.api.removeBook({ ...book, requestId: randomUUID() }),
      { status: 409 },
    );
    assert.deepEqual((await store.exportData()).books, []);
  });
  await store.forUser(alice, async () => {
    assert.equal((await store.api.getCollection()).books[0].series, series);
    assert.equal(store.currentUser().role, "user");
  });
});
