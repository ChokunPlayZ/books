import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { customFetch } from "openid-client";
import { openTestStore as openStore } from "../helpers/database.mjs";
import {
  authHash,
  cookieOptions,
  createAccount,
  sessionUser,
  signInWithGoogle,
} from "../../lib/server/auth.ts";
import {
  appOrigin,
  googleSettings,
  safeReturnTo,
} from "../../lib/server/auth-config.ts";
import {
  beginGoogleSignIn,
  consumeGoogleAttempt,
  createGoogleClient,
  finishGoogleSignIn,
} from "../../lib/server/google-oauth.ts";
import {
  authorizationCallback,
  googleTestEnvironment,
  googleTransport,
} from "../helpers/mock-google.mjs";

const owner = {
  sub: "google-owner",
  email: "owner@gmail.com",
  email_verified: true,
  picture: "https://lh3.googleusercontent.com/a/oauth-owner=s96-c",
};
const alice = {
  sub: "google-alice",
  email: "alice@gmail.com",
  email_verified: true,
};
async function setup(t) {
  const env = {
    ...googleTestEnvironment(),
    BOOKS_APP_URL: "http://localhost:3000",
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() =>
      previous === undefined
        ? delete process.env[key]
        : (process.env[key] = previous),
    );
  }
  const store = await openStore();
  t.after(async () => await store.close());
  const client = createGoogleClient(googleSettings());
  client[customFetch] = googleTransport(env.BOOKS_TEST_GOOGLE_PRIVATE_KEY, () =>
    assert.fail("Unexpected external request"),
  );
  return { store, client };
}

test("OAuth code flow validates PKCE and signed identity, claims the configured owner and rotates sessions", async (t) => {
  const { store, client } = await setup(t);
  const attempt = await beginGoogleSignIn(store, "/stats?period=year");
  assert.equal(attempt.url.origin, "https://accounts.google.com");
  assert.equal(attempt.url.searchParams.get("scope"), "openid email profile");
  assert.equal(attempt.url.searchParams.get("code_challenge_method"), "S256");
  const callback = authorizationCallback(attempt.url, owner);
  const login = await finishGoogleSignIn(
    store,
    callback,
    attempt.browserToken,
    client,
  );
  assert.equal(login.user.id, 1);
  assert.equal(login.user.role, "admin");
  assert.equal(login.returnTo, "/stats?period=year");
  assert.equal((await sessionUser(store, login.token)).id, 1);
  assert.equal(
    await store.forUser(
      login.user,
      async () => (await store.account.get()).picture,
    ),
    owner.picture,
  );
  assert.equal(
    (await store.db.prepare("SELECT COUNT(*) AS n FROM oauth_attempts").get())
      .n,
    0,
  );
  await assert.rejects(
    finishGoogleSignIn(store, callback, attempt.browserToken, client),
  );
  assert.ok(
    !JSON.stringify(
      await store.db.prepare("SELECT * FROM sessions").all(),
    ).includes("test-access-token"),
  );
  assert.deepEqual(cookieOptions(), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 14 * 86400,
  });
});

test("state is browser-bound, short-lived and consumed exactly once", async (t) => {
  const { store } = await setup(t);
  const attempt = await beginGoogleSignIn(store, "//evil.test");
  const state = attempt.url.searchParams.get("state");
  await assert.rejects(
    async () => await consumeGoogleAttempt(store, state, "a".repeat(64)),
  );
  await assert.rejects(
    async () =>
      await consumeGoogleAttempt(store, "wrong", attempt.browserToken),
  );
  assert.equal(
    (await consumeGoogleAttempt(store, state, attempt.browserToken)).returnTo,
    "/",
  );
  await assert.rejects(
    async () => await consumeGoogleAttempt(store, state, attempt.browserToken),
  );
  const expired = await beginGoogleSignIn(store, "/");
  await store.db.exec("UPDATE oauth_attempts SET expires_at=0");
  await assert.rejects(
    async () =>
      await consumeGoogleAttempt(
        store,
        expired.url.searchParams.get("state"),
        expired.browserToken,
      ),
  );
});

test("wrong nonce, issuer, audience, expiry, verification and signature never create sessions", async (t) => {
  const { store, client } = await setup(t);
  for (const overrides of [
    { nonce: "wrong" },
    { iss: "https://evil.test" },
    { aud: "another-client" },
    { exp: 1 },
    { email_verified: false },
  ]) {
    const attempt = await beginGoogleSignIn(store, "/");
    await assert.rejects(
      finishGoogleSignIn(
        store,
        authorizationCallback(attempt.url, alice, overrides),
        attempt.browserToken,
        client,
      ),
    );
  }
  const forged = createGoogleClient(googleSettings());
  // A different signing key is returned at the token endpoint than the JWKS.
  const trusted = googleTransport(
    googleTestEnvironment().BOOKS_TEST_GOOGLE_PRIVATE_KEY,
  );
  const attacker = googleTransport(
    googleTestEnvironment().BOOKS_TEST_GOOGLE_PRIVATE_KEY,
  );
  forged[customFetch] = (url, options) =>
    String(url).includes("/certs")
      ? trusted(url, options)
      : attacker(url, options);
  const attempt = await beginGoogleSignIn(store, "/");
  await assert.rejects(
    finishGoogleSignIn(
      store,
      authorizationCallback(attempt.url, alice),
      attempt.browserToken,
      forged,
    ),
  );
  const badPkce = await beginGoogleSignIn(store, "/");
  const callback = authorizationCallback(badPkce.url, alice);
  const code = JSON.parse(
    Buffer.from(callback.searchParams.get("code"), "base64url").toString(),
  );
  code.challenge = "wrong-pkce-challenge";
  callback.searchParams.set(
    "code",
    Buffer.from(JSON.stringify(code)).toString("base64url"),
  );
  await assert.rejects(
    finishGoogleSignIn(store, callback, badPkce.browserToken, client),
  );
  assert.equal(
    (await store.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).n,
    0,
  );
  assert.equal(
    (await store.db.prepare("SELECT COUNT(*) AS n FROM users").get()).n,
    1,
  );
});

test("public signup cannot claim admin; identities survive email changes and cannot be relinked by email", async (t) => {
  const { store } = await setup(t);
  const signup = await signInWithGoogle(store, alice);
  assert.notEqual(signup.user.id, 1);
  assert.equal(signup.user.role, "user");
  const admin = await signInWithGoogle(store, owner);
  assert.equal(admin.user.id, 1);
  const changed = await signInWithGoogle(store, {
    ...alice,
    email: "new-address@gmail.com",
  });
  assert.equal(changed.user.id, signup.user.id);
  const reusedEmail = await signInWithGoogle(store, {
    sub: "different-google",
    email: alice.email,
    email_verified: true,
  });
  assert.notEqual(reusedEmail.user.id, signup.user.id);
  assert.equal(reusedEmail.user.role, "user");
  await assert.rejects(
    async () =>
      await signInWithGoogle(store, {
        sub: "other",
        email: "new-address@gmail.com",
        email_verified: true,
      }),
    { status: 403 },
  );
  process.env.BOOKS_ADMIN_EMAIL = "new-admin@gmail.com";
  assert.equal(
    (
      await signInWithGoogle(store, {
        sub: "not-admin",
        email: "new-admin@gmail.com",
        email_verified: true,
      })
    ).user.role,
    "user",
  );
  assert.equal((await signInWithGoogle(store, owner)).user.id, 1);
});

test("legacy libraries are explicitly reserved, and Google must be authoritative when linking by email", async (t) => {
  const { store } = await setup(t);
  const reserved = await createAccount(store, "legacy", "reader@example.org");
  const external = {
    sub: "external-google",
    email: "reader@example.org",
    email_verified: true,
  };
  await assert.rejects(async () => await signInWithGoogle(store, external), {
    status: 403,
  });
  assert.equal(
    (await signInWithGoogle(store, { ...external, hd: "example.org" })).user.id,
    reserved.id,
  );
});

test("authentication fails closed even with legacy password and unauthenticated flags", async (t) => {
  const { store } = await setup(t);
  for (const key of [
    "BOOKS_PASSWORD",
    "BOOKS_ALLOW_UNAUTHENTICATED",
    "BOOKS_SECURE_COOKIES",
  ]) {
    const previous = process.env[key];
    process.env[key] = key === "BOOKS_PASSWORD" ? "old-password" : "true";
    t.after(() =>
      previous === undefined
        ? delete process.env[key]
        : (process.env[key] = previous),
    );
  }
  assert.equal(await sessionUser(store), null);
  await store.db
    .prepare("INSERT INTO sessions VALUES (?,?,1,'')")
    .run(authHash("a".repeat(64)), Date.now() + 60000);
  assert.equal(await sessionUser(store, "a".repeat(64)), null);
  process.env.BOOKS_APP_URL = "https://books.example.org";
  process.env.BOOKS_SECURE_COOKIES = "false";
  assert.equal(cookieOptions().secure, true);
});

test("password-derived sessions cannot authenticate or claim an existing library", async (t) => {
  const path = join(
    mkdtempSync(join(tmpdir(), "books-oauth-migration-")),
    "books.sqlite",
  );
  let store = await openStore(path);
  await store.api.saveBook({
    requestId: "google-migration-regression",
    book: {
      isbn: "",
      series: "Existing owner's library",
      type: "Manga",
      publisher: "",
      status: "Read",
      volume: 1,
      source: "",
      price: "",
      date: "",
      note: "Private existing note",
    },
  });
  await store.db
    .prepare("INSERT INTO sessions VALUES (?,9999999999999,1,'')")
    .run(authHash("a".repeat(64)));
  await store.db.exec("UPDATE users SET password_hash='old-password-hash'");
  await store.close();
  store = await openStore(path);
  t.after(async () => await store.close());
  assert.equal(await sessionUser(store, "a".repeat(64)), null);
  assert.equal(
    (await store.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).n,
    1,
  );
  assert.equal(
    (await store.db.prepare("SELECT username FROM users WHERE id=1").get())
      .username,
    "admin",
  );
  assert.equal(
    (await store.api.getCollection()).books[0].note,
    "Private existing note",
  );
});

test("Google sessions survive restart and are capped per account", async (t) => {
  await setup(t);
  const path = join(
    mkdtempSync(join(tmpdir(), "books-oauth-sessions-")),
    "books.sqlite",
  );
  let store = await openStore(path);
  const signedIn = await signInWithGoogle(store, owner);
  await store.close();
  store = await openStore(path);
  t.after(async () => await store.close());
  assert.equal((await sessionUser(store, signedIn.token)).id, 1);
  for (let index = 0; index < 12; index++) await signInWithGoogle(store, owner);
  assert.equal(
    (
      await store.db
        .prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=1")
        .get()
    ).n,
    10,
  );
});

test("outstanding OAuth attempts are bounded and expired attempts are reclaimed", async (t) => {
  const { store } = await setup(t);
  const insert = store.db.prepare(
    "INSERT INTO oauth_attempts VALUES (?, 'browser', 'verifier', 'nonce', '/', ?)",
  );
  await store.transaction(async () => {
    for (let index = 0; index < 1000; index++)
      await insert.run("state-" + index, Date.now() + 60000);
  });
  await assert.rejects(beginGoogleSignIn(store, "/"), { status: 429 });
  await store.db.exec("UPDATE oauth_attempts SET expires_at=0");
  await beginGoogleSignIn(store, "/");
  assert.equal(
    (await store.db.prepare("SELECT COUNT(*) AS n FROM oauth_attempts").get())
      .n,
    1,
  );
});

test("origins and redirect targets cannot be changed through URL syntax tricks", () => {
  const previous = process.env.BOOKS_APP_URL;
  try {
    for (const value of [
      "http://books.example.org",
      "https://user:pass@example.org",
      "https://example.org/path",
      "https://example.org?query",
      "not a URL",
    ]) {
      process.env.BOOKS_APP_URL = value;
      assert.throws(appOrigin);
    }
    for (const value of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "/\n/evil.test",
      "/api/logout",
      "/login",
      "/" + "x".repeat(2001),
    ])
      assert.equal(safeReturnTo(value), "/");
    assert.equal(
      safeReturnTo("/series/Title?isbn=9780140328721"),
      "/series/Title?isbn=9780140328721",
    );
  } finally {
    if (previous === undefined) delete process.env.BOOKS_APP_URL;
    else process.env.BOOKS_APP_URL = previous;
  }
});

test("HTTPS uses host-prefixed Secure cookies without a domain or insecure override", () => {
  const auth = new URL("../../lib/server/auth.ts", import.meta.url).href;
  const oauth = new URL("../../lib/server/google-oauth.ts", import.meta.url)
    .href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { SESSION_COOKIE, cookieOptions } from ${JSON.stringify(auth)};
    import { OAUTH_COOKIE, oauthCookieOptions } from ${JSON.stringify(oauth)};
    console.log(JSON.stringify({ session: SESSION_COOKIE, oauth: OAUTH_COOKIE, options: cookieOptions(), oauthOptions: oauthCookieOptions() }));
  `,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        BOOKS_APP_URL: "https://books.example.org",
        BOOKS_SECURE_COOKIES: "false",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const cookies = JSON.parse(result.stdout);
  assert.equal(cookies.session, "__Host-book_collection_session");
  assert.equal(cookies.oauth, "__Host-book_collection_oauth");
  for (const options of [cookies.options, cookies.oauthOptions]) {
    assert.equal(options.secure, true);
    assert.equal(options.path, "/");
    assert.equal(options.domain, undefined);
    assert.equal(options.httpOnly, true);
  }
});
