import Icon from "../Icon";

export default function CollectionTabs() {
  return (
    <nav className={"tabs"} aria-label={"Collection views"}>
      <button
        id={"collectionTab"}
        className={"tab active"}
        aria-pressed={"true"}
        disabled
      >
        <Icon name="books" />
        {"Collection "}
        <span id={"activeCount"} className={"sr-only"}>
          {"—"}
        </span>
      </button>
      <button
        id={"releasesTab"}
        className={"tab"}
        aria-pressed={"false"}
        disabled
      >
        <Icon name="spark" />
        {"New releases "}
        <span id={"releaseCount"} className={"tab-count"} hidden>
          {"—"}
        </span>
      </button>
      <button id="discoverTab" className="tab" aria-pressed="false" disabled>
        <Icon name="compass" />
        Discover titles
      </button>
      <button
        id={"trashTab"}
        className={"tab"}
        aria-pressed={"false"}
        aria-label={"Recently removed"}
        disabled
      >
        <Icon name="archive" />
        {"Removed "}
        <span id={"trashCount"} className={"tab-count"} hidden>
          {"0"}
        </span>
      </button>
    </nav>
  );
}
