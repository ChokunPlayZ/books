import { cache } from "react";
import { cookies } from "next/headers";
import { getApp } from "./app.ts";
import { sessionUser, SESSION_COOKIE } from "./auth.ts";
import { DEFAULT_PREFERENCES } from "../preferences.ts";
import { translator } from "../i18n.ts";

// React's request cache never shares one account's preferences with another.
export const accountPreferences = cache(async () => {
  // Read request data before opening a pool: prerendering and anonymous pages
  // must not require a database connection or build-time credentials.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    return { userId: null, preferences: DEFAULT_PREFERENCES };
  const { store } = await getApp();
  const user = await sessionUser(store, token);
  return {
    userId: user?.id ?? null,
    preferences: user
      ? await store.forUser(user, () => store.preferences.get())
      : DEFAULT_PREFERENCES,
  };
});

export async function getTranslations() {
  return translator((await accountPreferences()).preferences.locale);
}
