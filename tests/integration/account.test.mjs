import test from "node:test";
import assert from "node:assert/strict";
import { openTestStore } from "../helpers/database.mjs";
import { signInWithGoogle } from "../../lib/server/auth.ts";

test("account details are scoped to the current user and exclude credentials", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const identity = (name) => ({
    sub: `account-${name}`,
    email: `${name}@gmail.com`,
    email_verified: true,
  });
  const alice = await signInWithGoogle(store, identity("alice"));
  const bob = await signInWithGoogle(store, identity("bob"));
  const admin = await signInWithGoogle(
    store,
    identity("owner"),
    "owner@gmail.com",
  );
  await Promise.all(
    [alice, bob, admin].map(({ user }) =>
      store.forUser(user, async () => {
        assert.deepEqual(await store.account.get(), {
          id: user.id,
          username: user.username,
          email: user.id === admin.user.id ? "owner@gmail.com" : user.username,
          role: user.id === admin.user.id ? "admin" : "user",
          picture: null,
        });
      }),
    ),
  );
});

test("account details show the current Google email, not a stale username", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const identity = {
    sub: "account-email-change",
    email: "original@gmail.com",
    email_verified: true,
  };
  const { user } = await signInWithGoogle(store, identity);
  await signInWithGoogle(store, {
    ...identity,
    email: "updated@gmail.com",
  });
  await store.forUser(user, async () => {
    assert.deepEqual(await store.account.get(), {
      id: user.id,
      username: "original@gmail.com",
      email: "updated@gmail.com",
      role: "user",
      picture: null,
    });
  });
});

test("Google profile pictures refresh on sign-in and stay account-scoped", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const identity = {
    sub: "account-picture",
    email: "picture@gmail.com",
    email_verified: true,
    picture: "https://lh3.googleusercontent.com/a/first=s96-c",
  };
  const { user } = await signInWithGoogle(store, identity);
  const picture = () =>
    store.forUser(user, async () => (await store.account.get()).picture);
  assert.equal(await picture(), identity.picture);
  const bob = await signInWithGoogle(store, {
    sub: "account-picture-bob",
    email: "picture-bob@gmail.com",
    email_verified: true,
  });
  assert.equal(
    await store.forUser(
      bob.user,
      async () => (await store.account.get()).picture,
    ),
    null,
  );
  const updated = "https://lh3.googleusercontent.com/a/updated=s96-c";
  await signInWithGoogle(store, { ...identity, picture: updated });
  assert.equal(await picture(), updated);
  await signInWithGoogle(store, {
    ...identity,
    picture: "https://example.com/tracker",
  });
  assert.equal(await picture(), null);
});
