import LibraryShell from "./LibraryShell";
import CollectionActions from "./collection/CollectionActions";
import CollectionHeading from "./collection/CollectionHeading";
import CollectionStats from "./collection/CollectionStats";
import CollectionSpending from "./collection/CollectionSpending";
import SeriesHeader from "./collection/SeriesHeader";
import SeriesInfoPanel from "./collection/SeriesInfoPanel";
import SeriesEditor from "./collection/SeriesEditor";
import SeriesCatalogPanel from "./collection/SeriesCatalogPanel";
import VolumeIndex from "./collection/VolumeIndex";
import { normalizeBookType } from "../lib/domain/book-type.ts";
import ShelfBrowser from "./collection/ShelfBrowser";
import ReleasesPanel from "./collection/ReleasesPanel";
import DiscoveryPanel from "./collection/DiscoveryPanel";
import AdaptationPanel from "./collection/AdaptationPanel";
import MissingPanel from "./collection/MissingPanel";
import StatisticsPanel from "./collection/StatisticsPanel";
import UniversalSearch from "./collection/UniversalSearch";
import TitleDialog from "./collection/dialogs/TitleDialog";
import BookDialog from "./collection/dialogs/BookDialog";
import ScanDialog from "./collection/dialogs/ScanDialog";
import RemoveDialog from "./collection/dialogs/RemoveDialog";
import CheckDialog from "./collection/dialogs/CheckDialog";
import IsbnDialog from "./collection/dialogs/IsbnDialog";
import type { CollectionView } from "../lib/domain/navigation.ts";
import type { Store } from "../lib/server/store.ts";
import { getTranslations } from "../lib/server/preferences.ts";

export default async function CollectionShell({
  view,
  series,
  data,
  searchQuery = "",
}: {
  view: CollectionView;
  series: string | null;
  data: Awaited<ReturnType<Store["api"]["getCollection"]>>;
  searchQuery?: string;
}) {
  const t = await getTranslations();
  const shelf = view === "collection" || view === "trash";
  const overview = shelf && series === null;
  return (
    <>
      <LibraryShell
        view={view}
        data={data}
        className={series !== null ? "series-page" : ""}
        actions={<CollectionActions series={series} />}
      >
        <div id={"pageError"} className={"banner"} role={"alert"} hidden></div>
        {overview && <CollectionHeading removed={view === "trash"} />}
        {overview && <CollectionStats books={data.books} />}
        {series !== null && (
          <SeriesInfoPanel
            key={series}
            series={series}
            books={data.books}
            userId={data.user.id}
            header={<SeriesHeader series={series} books={data.books} />}
          >
            {shelf && (
              <ShelfBrowser
                data={data}
                series={series}
                removed={view === "trash"}
              />
            )}
            <VolumeIndex
              series={series}
              types={[
                ...new Set(
                  data.books
                    .filter((book) => book.series === series)
                    .map((book) => normalizeBookType(book.type)),
                ),
              ]}
            />
          </SeriesInfoPanel>
        )}
        {series !== null && <SeriesEditor />}
        {shelf && series === null && (
          <ShelfBrowser
            data={data}
            series={series}
            removed={view === "trash"}
          />
        )}
        {series !== null && <AdaptationPanel series={series} />}
        {series !== null && <SeriesCatalogPanel />}
        {view === "releases" && <ReleasesPanel />}
        {view === "discover" && <DiscoveryPanel />}
        {view === "search" && <UniversalSearch initialQuery={searchQuery} />}
        {view === "missing" && <MissingPanel books={data.books} />}
        {view === "stats" && (
          <StatisticsPanel
            initialBooks={data.books}
            today={new Date().toISOString().slice(0, 10)}
          />
        )}
        {view === "collection" && series === null && (
          <details className="spending-disclosure">
            <summary>{t("Collection spending")}</summary>
            <CollectionSpending />
          </details>
        )}
      </LibraryShell>
      <TitleDialog />
      <BookDialog canEditMetadata={data.user.role === "admin"} />
      <ScanDialog />
      <RemoveDialog />
      <CheckDialog />
      <IsbnDialog />
      <div id={"toast"} className={"toast"} role={"status"} hidden></div>
    </>
  );
}
