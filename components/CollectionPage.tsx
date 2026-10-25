import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import CollectionShell from "./CollectionShell";
import CollectionController from "./CollectionController";
import { getApp } from "../lib/server/app.ts";
import { hasSession, SESSION_COOKIE } from "../lib/server/auth.ts";
import {
  collectionPaths,
  seriesPath,
  type CollectionView,
} from "../lib/domain/navigation.ts";

export default async function CollectionPage({
  view = "collection",
  series = null,
  priceIsbn = "",
}: {
  view?: CollectionView;
  series?: string | null;
  priceIsbn?: string;
}) {
  const { store } = getApp();
  if (!hasSession(store, (await cookies()).get(SESSION_COOKIE)?.value)) {
    let destination =
      series === null ? collectionPaths[view] : seriesPath(series);
    if (view === "prices" && priceIsbn)
      destination += "?isbn=" + encodeURIComponent(priceIsbn);
    redirect(
      destination === "/"
        ? "/login"
        : "/login?returnTo=" + encodeURIComponent(destination),
    );
  }
  const data = store.api.getCollection();
  return (
    <>
      <CollectionShell
        view={view}
        series={series}
        data={data}
        priceIsbn={priceIsbn}
      />
      {view !== "stats" && <CollectionController view={view} series={series} />}
    </>
  );
}
