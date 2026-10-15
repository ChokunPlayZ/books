import Icon from "../Icon";
import LibraryBrand from "../LibraryBrand";

export default function CollectionHeader() {
  return (
    <header className={"top"}>
      <div className="top-inner flex items-center justify-between">
        <LibraryBrand />
        <div className={"top-actions"}>
          <a id={"dataLink"} className={"text-btn"} href={"/data"}>
            <Icon name="archive" />
            {"Data & backups"}
          </a>
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
            {"Add book"}
          </button>
        </div>
      </div>
    </header>
  );
}
