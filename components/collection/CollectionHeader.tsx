import Icon from "../Icon";
import LibraryBrand from "../LibraryBrand";
import ThemeToggle from "../ThemeToggle";

export default function CollectionHeader({
  series,
}: {
  series: string | null;
}) {
  return (
    <header className={"top"}>
      <div className="top-inner flex items-center justify-between">
        <LibraryBrand />
        <div className={"top-actions"}>
          <div className="header-links">
            <a id={"dataLink"} className={"text-btn"} href={"/data"}>
              <Icon name="archive" />
              <span>Data &amp; backups</span>
            </a>
            <ThemeToggle />
          </div>
        </div>
        <div className="capture-actions" aria-label="Book entry">
          <button id={"checkBookButton"} className={"btn"} disabled>
            <svg aria-hidden={"true"}>
              <use href={"#i-scan"} />
            </svg>
            {"Check a book"}
          </button>
          <button id={"addButton"} className={"btn primary"} disabled>
            <svg aria-hidden={"true"}>
              <use href={"#i-plus"} />
            </svg>
            {series === null ? "Add book" : "Add volume"}
          </button>
        </div>
      </div>
    </header>
  );
}
