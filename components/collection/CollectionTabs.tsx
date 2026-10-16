import Icon from "../Icon";
import {
  collectionPaths,
  type CollectionView,
} from "../../lib/domain/navigation.ts";
import type { Store } from "../../lib/server/store.ts";

export default function CollectionTabs({
  view,
  data,
}: {
  view: CollectionView;
  data: ReturnType<Store["api"]["getCollection"]>;
}) {
  return (
    <nav className="tabs" aria-label="Collection views">
      <a
        id="collectionTab"
        className={"tab" + (view === "collection" ? " active" : "")}
        href={collectionPaths.collection}
        aria-current={view === "collection" ? "page" : undefined}
      >
        <Icon name="books" />
        Collection
        <span id="activeCount" className="sr-only">
          {data.books.length}
        </span>
      </a>
      <a
        id="releasesTab"
        className={"tab" + (view === "releases" ? " active" : "")}
        href={collectionPaths.releases}
        aria-current={view === "releases" ? "page" : undefined}
      >
        <Icon name="spark" />
        New releases
        <span id="releaseCount" className="tab-count" hidden>
          —
        </span>
      </a>
      <a
        id="discoverTab"
        className={"tab" + (view === "discover" ? " active" : "")}
        href={collectionPaths.discover}
        aria-current={view === "discover" ? "page" : undefined}
      >
        <Icon name="compass" />
        Discover titles
      </a>
      <a
        id="trashTab"
        className={"tab" + (view === "trash" ? " active" : "")}
        href={collectionPaths.trash}
        aria-current={view === "trash" ? "page" : undefined}
        aria-label="Recently removed"
      >
        <Icon name="archive" />
        Removed
        <span id="trashCount" className="tab-count" hidden={!data.trash.length}>
          {data.trash.length}
        </span>
      </a>
    </nav>
  );
}
