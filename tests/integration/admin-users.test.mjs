import test from "node:test";
import assert from "node:assert/strict";
import { customFetch } from "openid-client";
import { openTestStore } from "../helpers/database.mjs";
import { createAdminUsers } from "../../lib/server/admin-users.ts";
import { createAdminService } from "../../lib/server/admin.ts";
import {
  signInWithGoogle,
  sessionUser,
  authHash,
} from "../../lib/server/auth.ts";
import {
  beginGoogleSignIn,
  finishGoogleSignIn,
  createGoogleClient,
} from "../../lib/server/google-oauth.ts";
import { googleSettings } from "../../lib/server/auth-config.ts";
import {
  googleTestEnvironment,
  googleTransport,
  authorizationCallback,
} from "../helpers/mock-google.mjs";

const identity = (name) => ({
  sub: "admin-user-" + name,
  email: name + "@gmail.com",
  email_verified: true,
});
async function setup(t) {
  for (const [key, value] of Object.entries({
    ...googleTestEnvironment(),
    BOOKS_APP_URL: "http://localhost:3000",
  })) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() =>
      old === undefined ? delete process.env[key] : (process.env[key] = old),
    );
  }
  const store = await openTestStore();
  t.after(() => store.close());
  const reader = await signInWithGoogle(store, identity("reader"));
  await store.forUser(reader.user, () =>
    store.api.saveBook({
      requestId: crypto.randomUUID(),
      book: {
        series: "Private library",
        type: "Manga",
        status: "Read",
        note: "Keep this note",
      },
    }),
  );
  return { store, reader, api: createAdminUsers(store) };
}
test("account management lists safe information, requires explicit library confirmation, audits access and prevents self lockout", async (t) => {
  const { store, reader, api } = await setup(t);
  const users = await api.getAdminUsers({ search: "reader" });
  assert.equal(users.total, 1);
  assert.equal(users.users[0].books, 1);
  assert.doesNotMatch(
    JSON.stringify(users),
    /google_subject|token_hash|password_hash|Keep this note/,
  );
  await assert.rejects(api.getAdminUserLibrary({ userId: reader.user.id }), {
    status: 403,
  });
  await assert.rejects(
    createAdminService(store).getSystemRecords({ resource: "books" }),
    { status: 403 },
  );
  assert.equal(
    (await api.getAdminUserLibrary({ userId: reader.user.id, confirmed: true }))
      .rows[0].note,
    "Keep this note",
  );
  assert.equal(
    (
      await store.db
        .prepare(
          "SELECT COUNT(*) AS n FROM admin_events WHERE action='library-viewed'",
        )
        .get()
    ).n,
    1,
  );
  await assert.rejects(api.manageAdminUser({ userId: 1, action: "disable" }), {
    status: 409,
  });
  await assert.rejects(
    api.manageAdminUser({ userId: 1, action: "role", value: "user" }),
    { status: 409 },
  );
  await api.manageAdminUser({
    userId: reader.user.id,
    action: "rename",
    value: "renamed",
  });
  assert.equal(
    (await api.getAdminUsers({ search: "renamed" })).users[0].id,
    reader.user.id,
  );
  await store.forUser(reader.user, async () => {
    for (const [name, arg] of [
      ["getAdminUsers"],
      ["getAdminUserLibrary", { userId: 1, confirmed: true }],
      ["manageAdminUser", { userId: 1, action: "disable" }],
      ["createAccountRelink", { userId: 1, email: "attacker@gmail.com" }],
      ["revokeAccountRelinks", { userId: 1 }],
    ])
      await assert.rejects(api[name](arg), { status: 403 });
  });
  await api.manageAdminUser({ userId: reader.user.id, action: "disable" });
  assert.equal(await sessionUser(store, reader.token), null);
  await assert.rejects(signInWithGoogle(store, identity("reader")), {
    status: 403,
  });
  await assert.rejects(
    store.forUser(reader.user, () => store.api.getCollection()),
    { status: 401 },
  );
  await api.manageAdminUser({ userId: reader.user.id, action: "enable" });
  const restored = await signInWithGoogle(store, identity("reader"));
  await api.manageAdminUser({
    userId: reader.user.id,
    action: "revoke-sessions",
  });
  assert.equal(await sessionUser(store, restored.token), null);
});

test("single-use email-bound invitations complete through browser-bound signed Google OAuth and preserve all user-owned records", async (t) => {
  const { store, reader, api } = await setup(t);
  await store.forUser(reader.user, () =>
    store.preferences.update({ locale: "th", theme: "dark" }),
  );
  const before = await store.forUser(reader.user, () => store.exportData());
  const invitation = await api.createAccountRelink({
    userId: reader.user.id,
    email: "destination@gmail.com",
  });
  const token = new URLSearchParams(new URL(invitation.url).hash.slice(1)).get(
    "token",
  );
  const row = await store.db.prepare("SELECT * FROM account_relinks").get();
  assert.equal(row.token_hash, authHash(token));
  assert.ok(!JSON.stringify(row).includes(token));
  assert.ok(
    await sessionUser(store, reader.token),
    "issuing an invitation does not sign out the original owner",
  );
  await assert.rejects(
    signInWithGoogle(store, identity("wrong"), undefined, authHash(token)),
    { status: 403 },
  );
  const attempt = await beginGoogleSignIn(store, "/", token);
  assert.ok(!attempt.url.href.includes(token));
  const client = createGoogleClient(googleSettings());
  client[customFetch] = googleTransport(
    process.env.BOOKS_TEST_GOOGLE_PRIVATE_KEY,
    () => assert.fail("Unexpected external request"),
  );
  const login = await finishGoogleSignIn(
    store,
    authorizationCallback(attempt.url, identity("destination")),
    attempt.browserToken,
    client,
  );
  assert.equal(login.user.id, reader.user.id);
  assert.equal(await sessionUser(store, reader.token), null);
  assert.equal((await sessionUser(store, login.token)).id, reader.user.id);
  const after = await store.forUser(login.user, () => store.exportData());
  assert.deepEqual({ ...after, exportedAt: before.exportedAt }, before);
  assert.deepEqual(
    await store.forUser(login.user, () => store.preferences.get()),
    { locale: "th", theme: "dark" },
  );
  await assert.rejects(beginGoogleSignIn(store, "/", token), { status: 403 });
});

test("re-link invitations reject expiry, revocation, replay and accounts already owning another library", async (t) => {
  const { store, reader, api } = await setup(t);
  const invite = async (email = "destination@gmail.com") => {
    const result = await api.createAccountRelink({
      userId: reader.user.id,
      email,
    });
    return new URLSearchParams(new URL(result.url).hash.slice(1)).get("token");
  };
  const old = await invite(),
    token = await invite();
  await assert.rejects(beginGoogleSignIn(store, "/", old), { status: 403 });
  await store.db.prepare("UPDATE account_relinks SET expires_at=0").run();
  await assert.rejects(beginGoogleSignIn(store, "/", token), { status: 403 });
  const revoked = await invite();
  await api.revokeAccountRelinks({ userId: reader.user.id });
  await assert.rejects(beginGoogleSignIn(store, "/", revoked), { status: 403 });
  const conflict = await invite();
  await signInWithGoogle(store, identity("destination"));
  await assert.rejects(
    signInWithGoogle(
      store,
      identity("destination"),
      undefined,
      authHash(conflict),
    ),
    { status: 409 },
  );
  assert.ok(await sessionUser(store, reader.token));
  await assert.rejects(
    api.createAccountRelink({
      userId: reader.user.id,
      email: "destination@gmail.com",
    }),
    { status: 409 },
  );
});
