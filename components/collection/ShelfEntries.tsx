import Icon from "../Icon";
import { seriesPath } from "../../lib/domain/navigation.ts";
import type { StoredBook } from "../../lib/types.ts";

function Cover({ book }: { book: StoredBook }) {
  return (
    <span className="cover-frame shelf-cover" aria-hidden="true">
      {book.coverId ? (
        <img src={"/api/covers/" + book.coverId} alt="" loading="lazy" />
      ) : (
        <span className="cover-placeholder">
          <Icon name="books" />
        </span>
      )}
    </span>
  );
}

export default function ShelfEntries({
  books,
  series,
  removed,
}: {
  books: StoredBook[];
  series: string | null;
  removed: boolean;
}) {
  const visible =
    series === null
      ? books
      : books.filter(
          (book) => (book.series.trim() || "Untitled series") === series,
        );
  if (!visible.length)
    return (
      <div className="empty">
        <h2>
          {removed
            ? "Nothing removed"
            : series === null
              ? "Your shelf starts here"
              : "No volumes found"}
        </h2>
        <p>
          {removed
            ? "Removed books will be kept here until you restore them."
            : "Add a book to your shelf to get started."}
        </p>
      </div>
    );

  if (series === null && !removed) {
    const groups = new Map<string, StoredBook[]>();
    for (const book of books) {
      const key = book.series.trim() || "Untitled series";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(book);
    }
    return [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 20)
      .map(([name, owned]) => (
        <a
          className="series-row"
          href={seriesPath(name)}
          key={name}
          aria-label={`Open ${name}, ${owned.length} owned ${owned.length === 1 ? "volume" : "volumes"}`}
        >
          <Cover book={owned[0]} />
          <span className="series-info">
            <span className="series-name">{name}</span>
            <span className="series-meta">
              {[
                ...new Set(owned.map((book) => book.type).filter(Boolean)),
              ].join(" / ")}
            </span>
          </span>
          <span className="series-total">{owned.length}</span>
          <span className="series-arrow">›</span>
        </a>
      ));
  }

  const volumes = removed
    ? books.slice(0, 20)
    : visible.sort(
        (a, b) =>
          (a.volume === "" ? Infinity : a.volume) -
            (b.volume === "" ? Infinity : b.volume) || a.row - b.row,
      );
  return volumes.map((book) => (
    <article className="book-row" key={book.row}>
      <div className="book-info">
        <Cover book={book} />
        <div className="book-copy">
          <h2 className="book-title">
            {removed
              ? book.series
              : book.volume === ""
                ? "Unnumbered book"
                : "Volume " + book.volume}
          </h2>
          <div className="book-meta">
            {book.isbn ? "ISBN " + book.isbn : book.type}
          </div>
        </div>
      </div>
      <div className="book-status">
        <span
          className={
            "status" +
            (book.status === "Read"
              ? " read"
              : book.status === "Reading"
                ? " reading"
                : "")
          }
        >
          {book.status || "No status"}
        </span>
      </div>
      <div className="price">{book.price === "" ? "—" : book.price}</div>
    </article>
  ));
}
