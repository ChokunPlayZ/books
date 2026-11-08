import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getApp } from "./app.ts";
import { sessionUser, SESSION_COOKIE } from "./auth.ts";
import { attachCoverPlaceholders } from "./covers.ts";
import { seriesFromPath } from "../domain/navigation.ts";

// Shared only within this request, including the page and its metadata.
export const pageCollection = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const { store } = await getApp();
  const user = await sessionUser(store, token);
  if (!user) return null;
  return store.forUser(user, async () =>
    attachCoverPlaceholders(store, await store.api.getCollection()),
  );
});

export const seriesPageName = cache(async (segment: string, query = "") => {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) notFound();
  const data = await pageCollection();
  if (!data)
    redirect(
      "/login?returnTo=" + encodeURIComponent("/series/" + segment + query),
    );
  const titles = [
    ...data.books.map((book) => book.series.trim() || "Untitled series"),
    ...data.trash.map(({ book }) => book.series.trim() || "Untitled series"),
    ...data.options.series,
    ...data.seriesCatalogs.map((catalog) => catalog.series),
    ...data.savedReleases.map((release) => release.series),
  ];
  try {
    return seriesFromPath(segment, titles);
  } catch {
    notFound();
  }
});
