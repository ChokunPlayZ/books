import Icon from "../Icon";
import type { StoredBook } from "../../lib/types.ts";
import { getTranslations } from "../../lib/server/preferences.ts";

export default async function CollectionStats({
  books,
}: {
  books: StoredBook[];
}) {
  const t = await getTranslations();
  const format = (value: number) =>
    new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
  const read = books.filter((book) => book.status === "Read").length;
  const progress = books.length ? Math.round((read / books.length) * 100) : 0;
  const missingPrices = books.filter((book) => book.price === "").length;
  return (
    <section
      id={"collectionStats"}
      className={"stats"}
      aria-label={t("Collection overview")}
    >
      <div className={"stat"}>
        <span className="stat-icon">
          <Icon name="books" />
        </span>
        <div className={"stat-label"}>{t("Books")}</div>
        <div id={"bookCount"} className={"stat-value"}>
          {format(books.length)}
        </div>
      </div>
      <div className={"stat"}>
        <span className="stat-icon">
          <Icon name="grid" />
        </span>
        <div className={"stat-label"}>{t("Series")}</div>
        <div id={"seriesCount"} className={"stat-value"}>
          {format(
            new Set(books.map((book) => book.series.trim()).filter(Boolean))
              .size,
          )}
        </div>
      </div>
      <div className={"stat"}>
        <span className="stat-icon">
          <Icon name="check" />
        </span>
        <div className={"stat-label"}>{t("Read")}</div>
        <div id={"readCount"} className={"stat-value"}>
          {format(read)}
        </div>
        <div id={"readNote"} className={"stat-note"}>
          {books.length
            ? t("{count}% of your shelf", { count: progress })
            : t("Your next read awaits")}
        </div>
        <div className="reading-progress" aria-hidden="true">
          <span id="readProgress" style={{ width: progress + "%" }} />
        </div>
      </div>
      <div className={"stat"}>
        <span className="stat-icon">
          <Icon name="wallet" />
        </span>
        <div className={"stat-label"}>{t("Spent (฿)")}</div>
        <div id={"spent"} className={"stat-value"}>
          {format(
            books.reduce((sum, book) => sum + Number(book.price || 0), 0),
          )}
        </div>
        <div id={"priceNote"} className={"stat-note"}>
          {missingPrices
            ? t(
                missingPrices === 1
                  ? "{count} book has no price"
                  : "{count} books have no price",
                { count: format(missingPrices) },
              )
            : ""}
        </div>
      </div>
    </section>
  );
}
