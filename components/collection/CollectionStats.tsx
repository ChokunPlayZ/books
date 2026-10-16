import Icon from "../Icon";
import type { StoredBook } from "../../lib/types.ts";

export default function CollectionStats({ books }: { books: StoredBook[] }) {
  const format = (value: number) =>
    new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
  const read = books.filter((book) => book.status === "Read").length;
  const progress = books.length ? Math.round((read / books.length) * 100) : 0;
  const missingPrices = books.filter((book) => book.price === "").length;
  return (
    <section
      id={"collectionStats"}
      className={"stats"}
      aria-label={"Collection overview"}
    >
      <div className={"stat"}>
        <span className="stat-icon">
          <Icon name="books" />
        </span>
        <div className={"stat-label"}>{"Books"}</div>
        <div id={"bookCount"} className={"stat-value"}>
          {format(books.length)}
        </div>
      </div>
      <div className={"stat"}>
        <span className="stat-icon">
          <Icon name="grid" />
        </span>
        <div className={"stat-label"}>{"Series"}</div>
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
        <div className={"stat-label"}>{"Read"}</div>
        <div id={"readCount"} className={"stat-value"}>
          {format(read)}
        </div>
        <div id={"readNote"} className={"stat-note"}>
          {books.length
            ? progress + "% of your shelf"
            : "Your next read awaits"}
        </div>
        <div className="reading-progress" aria-hidden="true">
          <span id="readProgress" style={{ width: progress + "%" }} />
        </div>
      </div>
      <div className={"stat"}>
        <span className="stat-icon">
          <Icon name="wallet" />
        </span>
        <div className={"stat-label"}>{"Spent (฿)"}</div>
        <div id={"spent"} className={"stat-value"}>
          {format(
            books.reduce((sum, book) => sum + Number(book.price || 0), 0),
          )}
        </div>
        <div id={"priceNote"} className={"stat-note"}>
          {missingPrices
            ? format(missingPrices) +
              (missingPrices === 1 ? " book has" : " books have") +
              " no price"
            : ""}
        </div>
      </div>
    </section>
  );
}
