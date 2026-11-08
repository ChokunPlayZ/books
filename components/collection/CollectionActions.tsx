import { getTranslations } from "../../lib/server/preferences.ts";

export default async function CollectionActions({
  series,
}: {
  series: string | null;
}) {
  const t = await getTranslations();
  return (
    <div className="capture-actions" aria-label={t("Book entry")}>
      <button id="checkBookButton" className="btn" disabled>
        <svg aria-hidden="true">
          <use href="#i-scan" />
        </svg>
        {t("Check a book")}
      </button>
      <button id="addButton" className="btn primary" disabled>
        <svg aria-hidden="true">
          <use href="#i-plus" />
        </svg>
        {t(series === null ? "Add book" : "Add volume")}
      </button>
    </div>
  );
}
