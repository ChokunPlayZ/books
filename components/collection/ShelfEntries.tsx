import Icon from "../Icon";
import { seriesPath } from "../../lib/domain/navigation.ts";
import type { StoredBook } from "../../lib/types.ts";
import { shelfCoverBook, coverTint } from "../../lib/domain/shelf.ts";
import { LIST_BATCH_SIZE } from "../../lib/domain/lists.ts";
import { getTranslations } from "../../lib/server/preferences.ts";

async function Cover({
  book,
  gallery = null,
}: {
  book: StoredBook;
  gallery?: "series" | "volume" | null;
}) {
  const t = await getTranslations();
  const series = book.series.trim() || "Untitled series";
  const title =
    gallery === "volume" && book.volume !== ""
      ? series + ", volume " + book.volume
      : series;
  return (
    <span
      className={
        "cover-frame shelf-cover" + (gallery ? ` ${gallery}-cover` : "")
      }
      aria-hidden="true"
    >
      {book.coverId ? (
        <img src={"/api/covers/" + book.coverId} alt="" loading="lazy" />
      ) : (
        <span
          className="cover-placeholder"
          data-tint={gallery ? coverTint(title) : undefined}
        >
          <Icon name="books" />
          {gallery && (
            <>
              <span className="placeholder-title">{title}</span>
              <span className="placeholder-label">{t("No cover")}</span>
            </>
          )}
        </span>
      )}
    </span>
  );
}

export default async function ShelfEntries({
  books,
  series,
  removed,
}: {
  books: StoredBook[];
  series: string | null;
  removed: boolean;
}) {
  const t = await getTranslations();
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
          {t(
            removed
              ? "Nothing removed"
              : series === null
                ? "Your shelf starts here"
                : "No volumes found",
          )}
        </h2>
        <p>
          {t(
            removed
              ? "Removed books will be kept here until you restore them."
              : "Add a book to your shelf to get started.",
          )}
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
      .slice(0, LIST_BATCH_SIZE)
      .map(([name, owned]) => (
        <a
          className="series-row series-card"
          href={seriesPath(name)}
          key={name}
          title={name}
          aria-label={t(
            owned.length === 1
              ? "Open {name}, {count} owned volume"
              : "Open {name}, {count} owned volumes",
            {
              name,
              count: owned.length,
            },
          )}
        >
          <Cover book={shelfCoverBook(owned)} gallery="series" />
          <span className="shelf-caption">{name}</span>
          <span className="shelf-detail">
            {owned.length} {t(owned.length === 1 ? "volume" : "volumes")}
          </span>
        </a>
      ));
  }

  const volumes = removed
    ? books.slice(0, LIST_BATCH_SIZE)
    : visible.sort(
        (a, b) =>
          (a.volume === "" ? Infinity : a.volume) -
            (b.volume === "" ? Infinity : b.volume) || a.row - b.row,
      );
  return volumes.slice(0, LIST_BATCH_SIZE).map((book) =>
    !removed ? (
      <button
        className="book-row book-card"
        type="button"
        key={book.row}
        title={
          book.series + (book.volume !== "" ? ", volume " + book.volume : "")
        }
        aria-label={t("Edit {name}", {
          name:
            book.series +
            (book.volume !== ""
              ? ", " + t("Volume {volume}", { volume: book.volume })
              : ""),
        })}
        aria-haspopup="dialog"
      >
        <Cover book={book} gallery="volume" />
        <span className="shelf-caption">
          {book.volume === ""
            ? book.series
            : t("Volume {volume}", { volume: book.volume })}
        </span>
        <span className="shelf-detail">{t(book.status || "No status")}</span>
      </button>
    ) : (
      <article className="book-row" key={book.row}>
        <div className="book-info">
          <Cover book={book} />
          <div className="book-copy">
            <h2 className="book-title">{book.series}</h2>
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
            {t(book.status || "No status")}
          </span>
        </div>
        <div className="price">{book.price === "" ? "—" : book.price}</div>
      </article>
    ),
  );
}
