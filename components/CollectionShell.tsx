import IconSymbols from "./collection/IconSymbols";
import CollectionHeader from "./collection/CollectionHeader";
import CollectionHeading from "./collection/CollectionHeading";
import CollectionStats from "./collection/CollectionStats";
import CollectionSpending from "./collection/CollectionSpending";
import CollectionTabs from "./collection/CollectionTabs";
import SeriesHeader from "./collection/SeriesHeader";
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

export default function CollectionShell() {
  return (
    <>
      <a className="skip-link" href="#libraryMain">
        Skip to library
      </a>
      <IconSymbols />
      <CollectionHeader />
      <main id="libraryMain" className="library-main" tabIndex={-1}>
        <div id={"pageError"} className={"banner"} role={"alert"} hidden></div>
        <CollectionHeading />
        <CollectionStats />
        <CollectionSpending />
        <CollectionTabs />
        <SeriesHeader />
        <SeriesCatalogPanel />
        <ShelfBrowser />
        <ReleasesPanel />
        <DiscoveryPanel />
        <footer className={"footer"}>
          <span id={"syncNote"}>{"Opening your library"}</span>
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
