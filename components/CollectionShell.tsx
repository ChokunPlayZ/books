import IconSymbols from "./collection/IconSymbols";
import CollectionHeader from "./collection/CollectionHeader";
import CollectionHeading from "./collection/CollectionHeading";
import CollectionStats from "./collection/CollectionStats";
import CollectionSpending from "./collection/CollectionSpending";
import CollectionTabs from "./collection/CollectionTabs";
import SeriesHeader from "./collection/SeriesHeader";
import SeriesEditor from "./collection/SeriesEditor";
import SeriesCatalogPanel from "./collection/SeriesCatalogPanel";
import ShelfBrowser from "./collection/ShelfBrowser";
import ReleasesPanel from "./collection/ReleasesPanel";
import DiscoveryPanel from "./collection/DiscoveryPanel";
import TitleDialog from "./collection/dialogs/TitleDialog";
import BookDialog from "./collection/dialogs/BookDialog";
import ScanDialog from "./collection/dialogs/ScanDialog";
import RemoveDialog from "./collection/dialogs/RemoveDialog";
import CheckDialog from "./collection/dialogs/CheckDialog";
import IsbnDialog from "./collection/dialogs/IsbnDialog";
import type { CollectionView } from "../lib/domain/navigation.ts";
import type { Store } from "../lib/server/store.ts";

export default function CollectionShell({
  view,
  series,
  data,
}: {
  view: CollectionView;
  series: string | null;
  data: ReturnType<Store["api"]["getCollection"]>;
}) {
  const shelf = view === "collection" || view === "trash";
  const overview = shelf && series === null;
  return (
    <>
      <a className="skip-link" href="#libraryMain">
        Skip to library
      </a>
      <IconSymbols />
      <CollectionHeader series={series} />
      <main
        id="libraryMain"
        className={"library-main" + (series !== null ? " series-page" : "")}
        tabIndex={-1}
      >
        <div id={"pageError"} className={"banner"} role={"alert"} hidden></div>
        {overview && <CollectionHeading removed={view === "trash"} />}
        {overview && <CollectionStats books={data.books} />}
        {view === "collection" && series === null && <CollectionSpending />}
        <CollectionTabs view={view} data={data} />
        {series !== null && <SeriesHeader series={series} books={data.books} />}
        {series !== null && <SeriesEditor />}
        {shelf && (
          <ShelfBrowser
            data={data}
            series={series}
            removed={view === "trash"}
          />
        )}
        {series !== null && <SeriesCatalogPanel />}
        {view === "releases" && <ReleasesPanel />}
        {view === "discover" && <DiscoveryPanel />}
        <footer className={"footer"}>
          <span id={"syncNote"}>{"Saved in your library"}</span>
          <span>Made for the love of books.</span>
        </footer>
      </main>
      <TitleDialog />
      <BookDialog />
      <ScanDialog />
      <RemoveDialog />
      <CheckDialog />
      <IsbnDialog />
      <div id={"toast"} className={"toast"} role={"status"} hidden></div>
    </>
  );
}
