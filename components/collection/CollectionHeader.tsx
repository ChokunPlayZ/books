import LibraryBrand from "../LibraryBrand";
import ThemeToggle from "../ThemeToggle";
import LanguageSelect from "../LanguageSelect";
import { getTranslations } from "../../lib/server/preferences.ts";

export default async function CollectionHeader({
  series,
}: {
  series: string | null;
}) {
  const t = await getTranslations();
  return (
    <header className={"top"}>
      <div className="top-inner flex items-center justify-between">
        <LibraryBrand />
        <div className={"top-actions"}>
          <div className="header-links">
            <LanguageSelect />
            <ThemeToggle />
          </div>
        </div>
        <div className="capture-actions" aria-label={t("Book entry")}>
          <button id={"checkBookButton"} className={"btn"} disabled>
            <svg aria-hidden={"true"}>
              <use href={"#i-scan"} />
            </svg>
            {t("Check a book")}
          </button>
          <button id={"addButton"} className={"btn primary"} disabled>
            <svg aria-hidden={"true"}>
              <use href={"#i-plus"} />
            </svg>
            {t(series === null ? "Add book" : "Add volume")}
          </button>
        </div>
      </div>
    </header>
  );
}
