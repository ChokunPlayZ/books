import Icon from "../Icon";
import NavigationPosition from "./NavigationPosition";
import {
  collectionPaths,
  type LibraryView,
} from "../../lib/domain/navigation.ts";
import type { Store } from "../../lib/server/store.ts";
import { getTranslations } from "../../lib/server/preferences.ts";

export default async function CollectionTabs({
  view,
  data,
}: {
  view: LibraryView | null;
  data: Awaited<ReturnType<Store["api"]["getCollection"]>>;
}) {
  const t = await getTranslations();
  return (
    <nav
      id="libraryNavigation"
      className="tabs"
      aria-label={t("Collection views")}
    >
      <NavigationPosition view={view ?? "legal"} />
      <a
        id="collectionTab"
        className={"tab" + (view === "collection" ? " active" : "")}
        href={collectionPaths.collection}
        aria-current={view === "collection" ? "page" : undefined}
      >
        <Icon name="books" />
        <span className="tab-label">{t("Collection")}</span>
        <span id="activeCount" className="sr-only">
          {data.books.length}
        </span>
      </a>
      <a
        id="searchTab"
        className={"tab" + (view === "search" ? " active" : "")}
        href={collectionPaths.search}
        aria-current={view === "search" ? "page" : undefined}
      >
        <Icon name="search" />
        <span className="tab-label">{t("Search")}</span>
      </a>
      <a
        id="missingTab"
        className={"tab" + (view === "missing" ? " active" : "")}
        href={collectionPaths.missing}
        aria-current={view === "missing" ? "page" : undefined}
      >
        <Icon name="missing" />
        <span className="tab-label">{t("What’s missing")}</span>
      </a>
      <a
        id="releasesTab"
        className={"tab" + (view === "releases" ? " active" : "")}
        href={collectionPaths.releases}
        aria-current={view === "releases" ? "page" : undefined}
      >
        <Icon name="spark" />
        <span className="tab-label">{t("New releases")}</span>
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
        <span className="tab-label">{t("Discover titles")}</span>
      </a>
      <a
        id="statsTab"
        className={"tab" + (view === "stats" ? " active" : "")}
        href={collectionPaths.stats}
        aria-current={view === "stats" ? "page" : undefined}
      >
        <Icon name="chart" />
        <span className="tab-label">{t("Statistics")}</span>
      </a>
      <a
        id="trashTab"
        className={"tab" + (view === "trash" ? " active" : "")}
        href={collectionPaths.trash}
        aria-current={view === "trash" ? "page" : undefined}
        aria-label={t("Recently removed")}
      >
        <Icon name="archive" />
        <span className="tab-label">{t("Removed")}</span>
        <span id="trashCount" className="tab-count" hidden={!data.trash.length}>
          {data.trash.length}
        </span>
      </a>
      <a
        id="settingsLink"
        className={"tab" + (view === "settings" ? " active" : "")}
        href="/settings"
        aria-current={view === "settings" ? "page" : undefined}
      >
        <Icon name="user" />
        <span className="tab-label">{t("User settings")}</span>
      </a>
      <a
        id="dataLink"
        className={"tab" + (view === "data" ? " active" : "")}
        href="/data"
        aria-current={view === "data" ? "page" : undefined}
      >
        <Icon name="archive" />
        <span className="tab-label">{t("Data & backups")}</span>
      </a>
    </nav>
  );
}
