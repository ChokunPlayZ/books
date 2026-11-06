import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { customFetch } from "openid-client";
import { openStore } from "../../lib/server/store.ts";
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
};
const alice = {
  sub: "google-alice",
  email: "alice@gmail.com",
  email_verified: true,
};
function setup(t) {
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
  const store = openStore(":memory:");
  t.after(() => store.close());
  const client = createGoogleClient(googleSettings());
  client[customFetch] = googleTransport(env.BOOKS_TEST_GOOGLE_PRIVATE_KEY, () =>
    assert.fail("Unexpected external request"),
  );
  return { store, client };
}

test("OAuth code flow validates PKCE and signed identity, claims the configured owner and rotates sessions", async (t) => {
  const { store, client } = setup(t);
  const attempt = await beginGoogleSignIn(store, "/stats?period=year");
  assert.equal(attempt.url.origin, "https://accounts.google.com");
  assert.equal(attempt.url.searchParams.get("scope"), "openid email");
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
  assert.equal(sessionUser(store, login.token).id, 1);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM oauth_attempts").get().n,
    0,
  );
  await assert.rejects(
    finishGoogleSignIn(store, callback, attempt.browserToken, client),
  );
  assert.ok(
    !JSON.stringify(store.db.prepare("SELECT * FROM sessions").all()).includes(
      "test-access-token",
    ),
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
  const { store } = setup(t);
  const attempt = await beginGoogleSignIn(store, "//evil.test");
  const state = attempt.url.searchParams.get("state");
  assert.throws(() => consumeGoogleAttempt(store, state, "a".repeat(64)));
  assert.throws(() =>
    consumeGoogleAttempt(store, "wrong", attempt.browserToken),
  );
  assert.equal(
    consumeGoogleAttempt(store, state, attempt.browserToken).returnTo,
    "/",
  );
  assert.throws(() => consumeGoogleAttempt(store, state, attempt.browserToken));
  const expired = await beginGoogleSignIn(store, "/");
  store.db.exec("UPDATE oauth_attempts SET expires_at=0");
  assert.throws(() =>
    consumeGoogleAttempt(
      store,
      expired.url.searchParams.get("state"),
      expired.browserToken,
    ),
  );
});

test("wrong nonce, issuer, audience, expiry, verification and signature never create sessions", async (t) => {
  const { store, client } = setup(t);
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
    store.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,
    0,
  );
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
});

test("public signup cannot claim admin; identities survive email changes and cannot be relinked by email", (t) => {
  const { store } = setup(t);
  const signup = signInWithGoogle(store, alice);
  assert.notEqual(signup.user.id, 1);
  assert.equal(signup.user.role, "user");
  const admin = signInWithGoogle(store, owner);
  assert.equal(admin.user.id, 1);
  const changed = signInWithGoogle(store, {
    ...alice,
    email: "new-address@gmail.com",
  });
  assert.equal(changed.user.id, signup.user.id);
  const reusedEmail = signInWithGoogle(store, {
    sub: "different-google",
    email: alice.email,
    email_verified: true,
  });
  assert.notEqual(reusedEmail.user.id, signup.user.id);
  assert.equal(reusedEmail.user.role, "user");
  assert.throws(
    () =>
      signInWithGoogle(store, {
        sub: "other",
        email: "new-address@gmail.com",
        email_verified: true,
      }),
    { status: 403 },
  );
  process.env.BOOKS_ADMIN_EMAIL = "new-admin@gmail.com";
  assert.equal(
    signInWithGoogle(store, {
      sub: "not-admin",
      email: "new-admin@gmail.com",
      email_verified: true,
    }).user.role,
    "user",
  );
  assert.equal(signInWithGoogle(store, owner).user.id, 1);
});

test("legacy libraries are explicitly reserved, and Google must be authoritative when linking by email", (t) => {
  const { store } = setup(t);
  const reserved = createAccount(store, "legacy", "reader@example.org");
  const external = {
    sub: "external-google",
    email: "reader@example.org",
    email_verified: true,
  };
  assert.throws(() => signInWithGoogle(store, external), { status: 403 });
  assert.equal(
    signInWithGoogle(store, { ...external, hd: "example.org" }).user.id,
    reserved.id,
  );
});

test("authentication fails closed even with legacy password and unauthenticated flags", (t) => {
  const { store } = setup(t);
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
  assert.equal(sessionUser(store), null);
  store.db
    .prepare("INSERT INTO sessions VALUES (?,?,1,'')")
    .run(authHash("a".repeat(64)), Date.now() + 60000);
  assert.equal(sessionUser(store, "a".repeat(64)), null);
  process.env.BOOKS_APP_URL = "https://books.example.org";
  process.env.BOOKS_SECURE_COOKIES = "false";
  assert.equal(cookieOptions().secure, true);
});

test("v5 migration preserves libraries and invalidates all password sessions", (t) => {
  const path = join(
    mkdtempSync(join(tmpdir(), "books-oauth-migration-")),
    "books.sqlite",
  );
  let store = openStore(path);
  store.api.saveBook({
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
  store.db.exec(
    `DROP TABLE oauth_attempts; DROP TABLE request_limits; DROP INDEX sessions_expiry; DROP INDEX sessions_user_expiry; DROP INDEX users_google_subject; DROP INDEX users_email; ALTER TABLE users DROP COLUMN google_subject; ALTER TABLE users DROP COLUMN email; PRAGMA user_version=5;`,
  );
  store.db
    .prepare("INSERT INTO sessions VALUES (?,9999999999999,1,'')")
    .run(authHash("a".repeat(64)));
  store.db.exec("UPDATE users SET password_hash='old-password-hash'");
  store.close();
  store = openStore(path);
  t.after(() => store.close());
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 6);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,
    0,
  );
  assert.equal(
    store.db.prepare("SELECT username FROM users WHERE id=1").get().username,
    "admin",
  );
  assert.equal(
    store.api.getCollection().books[0].note,
    "Private existing note",
  );
});

test("Google sessions survive restart and are capped per account", (t) => {
  setup(t);
  const path = join(
    mkdtempSync(join(tmpdir(), "books-oauth-sessions-")),
    "books.sqlite",
  );
  let store = openStore(path);
  const signedIn = signInWithGoogle(store, owner);
  store.close();
  store = openStore(path);
  t.after(() => store.close());
  assert.equal(sessionUser(store, signedIn.token).id, 1);
  for (let index = 0; index < 12; index++) signInWithGoogle(store, owner);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=1").get()
      .n,
    10,
  );
});

test("outstanding OAuth attempts are bounded and expired attempts are reclaimed", async (t) => {
  const { store } = setup(t);
  const insert = store.db.prepare(
    "INSERT INTO oauth_attempts VALUES (?, 'browser', 'verifier', 'nonce', '/', ?)",
  );
  store.transaction(() => {
    for (let index = 0; index < 1000; index++)
      insert.run("state-" + index, Date.now() + 60000);
  });
  await assert.rejects(beginGoogleSignIn(store, "/"), { status: 429 });
  store.db.exec("UPDATE oauth_attempts SET expires_at=0");
  await beginGoogleSignIn(store, "/");
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM oauth_attempts").get().n,
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
