import { redirect } from "next/navigation";
import CollectionShell from "./CollectionShell";
import CollectionController from "./CollectionController";
import { pageCollection } from "../lib/server/collection-page.ts";
import {
  collectionPaths,
  seriesPath,
  type CollectionView,
} from "../lib/domain/navigation.ts";

export default async function CollectionPage({
  view = "collection",
  series = null,
  searchQuery = "",
}: {
  view?: CollectionView;
  series?: string | null;
  searchQuery?: string;
}) {
  const data = await pageCollection();
  if (!data) {
    let destination =
      series === null ? collectionPaths[view] : seriesPath(series);
    if (view === "search" && searchQuery)
      destination += "?q=" + encodeURIComponent(searchQuery);
    redirect(
      destination === "/"
        ? "/login"
        : "/login?returnTo=" + encodeURIComponent(destination),
    );
  }
  return (
    <>
      <CollectionShell
        view={view}
        series={series}
        data={data}
        searchQuery={searchQuery}
      />
      {view !== "stats" && <CollectionController view={view} series={series} />}
    </>
  );
}
