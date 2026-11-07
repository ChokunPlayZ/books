import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import CollectionShell from "./CollectionShell";
import CollectionController from "./CollectionController";
import { getApp } from "../lib/server/app.ts";
import { sessionUser, SESSION_COOKIE } from "../lib/server/auth.ts";
import {
  collectionPaths,
  seriesPath,
  type CollectionView,
} from "../lib/domain/navigation.ts";

export default async function CollectionPage({
  view = "collection",
  series = null,
  priceIsbn = "",
  searchQuery = "",
}: {
  view?: CollectionView;
  series?: string | null;
  priceIsbn?: string;
  searchQuery?: string;
}) {
  const { store } = await getApp();
  const user = await sessionUser(
    store,
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (!user) {
    let destination =
      series === null ? collectionPaths[view] : seriesPath(series);
    if (view === "prices" && priceIsbn)
      destination += "?isbn=" + encodeURIComponent(priceIsbn);
    if (view === "search" && searchQuery)
      destination += "?q=" + encodeURIComponent(searchQuery);
    redirect(
      destination === "/"
        ? "/login"
        : "/login?returnTo=" + encodeURIComponent(destination),
    );
  }
  const data = await store.forUser(
    user,
    async () => await store.api.getCollection(),
  );
  return (
    <>
      <CollectionShell
        view={view}
        series={series}
        data={data}
        priceIsbn={priceIsbn}
        searchQuery={searchQuery}
      />
      {view !== "stats" && <CollectionController view={view} series={series} />}
    </>
  );
}
