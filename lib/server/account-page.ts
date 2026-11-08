import { cache } from "react";
import { cookies } from "next/headers";
import { getApp } from "./app.ts";
import { sessionUser, SESSION_COOKIE } from "./auth.ts";

// Shared by the header and settings only within the current request.
export const pageAccount = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const { store } = await getApp();
  const user = await sessionUser(store, token);
  return user ? store.forUser(user, () => store.account.get()) : null;
});
