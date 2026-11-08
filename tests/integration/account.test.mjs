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
    });
  });
});
