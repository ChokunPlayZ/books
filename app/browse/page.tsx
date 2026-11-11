import { redirect } from "next/navigation";
import LibraryShell from "../../components/LibraryShell";
import ShelfEntries from "../../components/collection/ShelfEntries";
import { pageCollection } from "../../lib/server/collection-page.ts";
import { getApp } from "../../lib/server/app.ts";
import { getTranslations } from "../../lib/server/preferences.ts";
import type { StoredBook } from "../../lib/types.ts";
import ExternalLink from "../../components/ExternalLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "Browse related titles · meemai" };

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const field =
    typeof query.field === "string" ? query.field.slice(0, 100) : "";
  const value =
    typeof query.value === "string" ? query.value.slice(0, 2000) : "";
  const data = await pageCollection();
  if (!data)
    redirect(
      "/login?returnTo=" +
        encodeURIComponent("/browse?" + new URLSearchParams({ field, value })),
    );
  const t = await getTranslations();
  const { store, api } = await getApp();
  const result: {
    books: StoredBook[];
    known: { title: string; publisher: string; type: string; url: string }[];
  } =
    field && value
      ? await store.forUser(data.user, () =>
          api.getMetadataBrowse({ field, value }),
        )
      : { books: [], known: [] };
  return (
    <LibraryShell
      data={data}
      view="collection"
      className="metadata-browse-page"
    >
      <a className="text-btn" href="/">
        {t("← All series")}
      </a>
      <h1>{value || t("Browse related titles")}</h1>
      <p className="hint">
        {t(field)} · {t("Titles in your library with matching metadata")}
      </p>
      {result.books.length ? (
        <div className="collection cover-grid">
          <ShelfEntries books={result.books} series={null} removed={false} />
        </div>
      ) : (
        <p className="empty">
          {t(
            "No matching titles saved. Pull series details on other titles to make their creators and tags browsable.",
          )}
        </p>
      )}
      {!!result.known.length && (
        <section className="series-volume-index">
          <h2>{t("Known titles from sources")}</h2>
          <ul>
            {result.known.map((item) => (
              <li
                key={item.title + item.publisher}
                className="metadata-known-title"
              >
                <div>
                  <a
                    href={
                      "/search?q=" +
                      encodeURIComponent(item.title.slice(0, 200))
                    }
                  >
                    {item.title}
                  </a>
                  <span className="hint">
                    {item.publisher} · {t(item.type)}
                  </span>
                </div>
                <ExternalLink href={item.url} target="_blank">
                  {t("View source")}
                </ExternalLink>
              </li>
            ))}
          </ul>
        </section>
      )}
      <a
        className="btn"
        href={"/search?q=" + encodeURIComponent(value.slice(0, 200))}
      >
        {t("Search more titles")}
      </a>
    </LibraryShell>
  );
}
