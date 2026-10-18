import { $, node, number } from "./dom.ts";
import { createInfiniteList } from "./infinite-list.ts";
import { missingSummary, seriesGaps, publisherKey } from "./matching.ts";
import {
  collectionMissing,
  missingCatalogSpecs,
  missingCatalogKey,
  catalogReviewCount,
  type MissingCatalog,
} from "./missing-catalogs.ts";
import { PUBLISHERS } from "../domain/constants.ts";
import { seriesPath } from "../domain/navigation.ts";
import { safeProductUrl } from "../domain/urls.ts";
import type { Release, StoredBook } from "../types.ts";

export function createMissingBrowser({
  addVolume,
  addCatalogVolume,
  rpc,
  signal,
}: {
  addVolume: (
    series: string,
    edition: ReturnType<typeof seriesGaps<StoredBook>>[number],
    volume: number,
  ) => void;
  addCatalogVolume: (item: Release) => void;
  rpc: (name: string, arg: unknown) => Promise<MissingCatalog["feed"]>;
  signal: AbortSignal;
}) {
  if (!$("missingList")) return null;
  const list = createInfiniteList($("missingList"));
  const feeds = new Map<string, MissingCatalog["feed"]>();
  let books: StoredBook[] = [];
  let running: Promise<void> | null = null;
  let disposed = false;
  let completed = 0;
  let total = 0;

  function catalogs() {
    return missingCatalogSpecs(books).map((spec) => ({
      ...spec,
      feed: feeds.get(missingCatalogKey(spec)),
    }));
  }
  function render(updatedBooks = books) {
    if (disposed || signal.aborted) return;
    books = updatedBooks;
    const checks = catalogs();
    const unsupported = new Map<
      string,
      { series: string; type: string; publisher: string }
    >();
    for (const book of books) {
      if (
        !PUBLISHERS.some(
          (publisher) => publisher.id === publisherKey(book.publisher),
        )
      ) {
        const series = book.series.trim() || "Untitled series";
        unsupported.set(
          JSON.stringify([series, book.type, publisherKey(book.publisher)]),
          { series, type: book.type, publisher: book.publisher },
        );
      }
    }
    const pending = checks.some((check) => !check.feed);
    const incomplete = checks.filter(
      (check) =>
        check.feed &&
        (check.feed.error ||
          check.feed.stale ||
          check.feed.needsSelection ||
          !check.feed.complete ||
          catalogReviewCount(check, books)),
    );
    $("refreshMissingCatalogs").disabled = !!running || !checks.length;
    $("refreshMissingCatalogs").textContent = running
      ? "Checking catalogs…"
      : "Refresh catalogs";
    $("missingCatalogStatus").textContent = [
      running
        ? `Checking publisher catalogs · ${number(completed)} of ${number(total)} editions checked`
        : pending
          ? "Checking publisher catalogs…"
          : `${number(checks.length)} publisher catalogs checked`,
      incomplete.length ? `${number(incomplete.length)} need attention` : "",
      unsupported.size
        ? `${number(unsupported.size)} ${unsupported.size === 1 ? "edition has" : "editions have"} no supported catalog source`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    $("missingCoverage").hidden = !books.length;
    $("missingCoverageSummary").textContent =
      "Catalog coverage" +
      (incomplete.length ? " · Checks need attention" : "");
    const coverage = $("missingCoverageList");
    coverage.replaceChildren();
    for (const check of checks) {
      const feed = check.feed;
      const status = !feed
        ? "Checking…"
        : feed.needsSelection
          ? "Choose a catalog on the series page"
          : feed.error || feed.stale || !feed.complete
            ? "Catalog check incomplete · Showing available listings"
            : catalogReviewCount(check, books)
              ? "Check other editions on the series page"
              : "Catalog checked";
      const entry = node("li");
      const link = node(
        "a",
        "",
        [
          check.series,
          check.type,
          PUBLISHERS.find((p) => p.id === check.publisherId)?.name,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      link.href = seriesPath(check.series);
      entry.append(link, node("span", "hint", status));
      coverage.append(entry);
    }
    for (const edition of unsupported.values()) {
      const entry = node("li");
      const link = node(
        "a",
        "",
        [edition.series, edition.type, edition.publisher]
          .filter(Boolean)
          .join(" · "),
      );
      link.href = seriesPath(edition.series);
      entry.append(
        link,
        node("span", "hint", "Catalog unavailable · Shelf gaps only"),
      );
      coverage.append(entry);
    }

    const search = $("missingSearch").value.trim().toLocaleLowerCase();
    const groups = collectionMissing(books, checks).filter((group) =>
      [
        group.series,
        ...group.editions.flatMap((edition) => [
          edition.type,
          edition.publisher,
        ]),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search),
    );
    if ($("missingSort").value === "missing")
      groups.sort(
        (a, b) => b.missing - a.missing || a.series.localeCompare(b.series),
      );
    $("missingSummary").textContent = missingSummary(groups);
    list.render(
      groups,
      (group) => {
        const card = node("article", "missing-series");
        const heading = node("header", "missing-series-heading");
        const title = node("h2");
        const titleLink = node("a", "", group.series);
        titleLink.href = seriesPath(group.series);
        title.append(titleLink);
        heading.append(
          title,
          node("span", "missing-total", number(group.missing) + " missing"),
        );
        card.append(heading);
        for (const edition of group.editions) {
          const row = node("div", "missing-series-edition");
          row.append(
            node(
              "h3",
              "",
              [edition.type, edition.publisher].filter(Boolean).join(" · ") ||
                "Edition not recorded",
            ),
          );
          if (edition.ranges.length) {
            row.append(
              node(
                "p",
                "hint",
                `Shelf gaps through volume ${number(edition.highest)}`,
              ),
            );
            const ranges = node("div", "missing-ranges");
            ranges.setAttribute("role", "group");
            ranges.setAttribute("aria-label", "Missing volumes");
            for (const [from, to] of edition.ranges) {
              const add = node(
                "button",
                "btn missing-volume",
                `Vol. ${from}${to > from ? "–" + to : ""} +`,
              );
              add.type = "button";
              add.setAttribute(
                "aria-label",
                `Add missing volume ${from} of ${group.series}, ${[edition.type, edition.publisher].filter(Boolean).join(", ")}`,
              );
              add.onclick = () => addVolume(group.series, edition, from);
              ranges.append(add);
            }
            row.append(ranges);
          }
          if (edition.catalogVolumes.length) {
            row.append(
              node(
                "p",
                "hint missing-catalog-label",
                "Not on your shelf · Publisher catalog",
              ),
            );
            const volumes = node("div", "missing-catalog-volumes");
            for (const { item, alternatives } of edition.catalogVolumes) {
              const volume = node("div", "missing-catalog-volume");
              const add = node(
                "button",
                "btn missing-volume",
                `Vol. ${item.volume} +`,
              );
              add.type = "button";
              add.setAttribute(
                "aria-label",
                `Add catalog volume ${item.volume} of ${group.series}, ${[edition.type, edition.publisher].filter(Boolean).join(", ")}`,
              );
              add.onclick = () => addCatalogVolume(item);
              volume.append(add);
              if (item.availability)
                volume.append(node("span", "hint", item.availability));
              const url = safeProductUrl(item.url, item.publisherId);
              if (url) {
                const publisher = node("a", "", "Publisher ↗");
                publisher.href = url;
                publisher.target = "_blank";
                publisher.rel = "noopener noreferrer";
                volume.append(publisher);
              }
              if (alternatives.length)
                volume.append(
                  node(
                    "span",
                    "hint",
                    `${number(alternatives.length)} other ${alternatives.length === 1 ? "listing" : "listings"}`,
                  ),
                );
              volumes.append(volume);
            }
            row.append(volumes);
          }
          card.append(row);
        }
        const link = node(
          "a",
          "missing-series-link",
          "View series & catalog →",
        );
        link.href = seriesPath(group.series);
        card.append(link);
        return card;
      },
      {
        key: JSON.stringify([search, $("missingSort").value]),
        label: "series",
      },
    );
    if (!groups.length) {
      const empty = node("div", "empty");
      const checking = pending || !!running;
      const partial = incomplete.length || unsupported.size;
      empty.append(
        node(
          "h2",
          "",
          !books.length
            ? "Your shelf starts here"
            : checking
              ? "Checking publisher catalogs…"
              : search
                ? "No matching series"
                : partial
                  ? "No missing volumes found in available data"
                  : "No missing volumes found",
        ),
        node(
          "p",
          "",
          !books.length
            ? "Add volumes to your collection to see what’s missing."
            : checking
              ? "Unowned catalog volumes will appear as checks finish, including volumes beyond your shelf."
              : search
                ? "Try another series, type or publisher."
                : partial
                  ? "Some editions could not be fully checked. Review catalog coverage for details."
                  : "No shelf gaps or unowned volumes in the checked publisher catalogs.",
        ),
      );
      const link = node("a", "btn", "View collection");
      link.href = "/";
      empty.append(link);
      $("missingList").append(empty);
    }
  }

  function loadCatalogs(refresh = false): Promise<void> {
    if (disposed || signal.aborted) return Promise.resolve();
    if (running) return running;
    const specs = missingCatalogSpecs(books).filter(
      (spec) => refresh || !feeds.has(missingCatalogKey(spec)),
    );
    if (!specs.length) return Promise.resolve();
    completed = 0;
    total = specs.length;
    let cursor = 0;
    // Defer workers until `running` is set so renders consistently show loading.
    running = Promise.resolve()
      .then(() =>
        Promise.all(
          Array.from({ length: Math.min(3, specs.length) }, async () => {
            while (cursor < specs.length && !disposed && !signal.aborted) {
              const spec = specs[cursor++];
              const key = missingCatalogKey(spec);
              try {
                const feed = await rpc("getSeriesCatalog", {
                  series: spec.series,
                  publisherId: spec.publisherId,
                  type: spec.type,
                  refresh,
                });
                if (!feed || !Array.isArray(feed.items))
                  throw new Error("Invalid catalog response");
                feeds.set(key, feed);
              } catch {
                if (disposed || signal.aborted) return;
                const previous = feeds.get(key);
                feeds.set(key, {
                  ...previous,
                  items: previous?.items || [],
                  complete: false,
                  stale: true,
                  error: "Catalog unavailable",
                });
              }
              completed++;
              render();
            }
          }),
        ),
      )
      .then(() => {})
      .finally(() => {
        running = null;
        render();
        // A purchase may introduce an edition while the previous batch is running.
        if (
          !disposed &&
          !signal.aborted &&
          missingCatalogSpecs(books).some(
            (spec) => !feeds.has(missingCatalogKey(spec)),
          )
        )
          void loadCatalogs();
      });
    render();
    return running;
  }
  return {
    render,
    loadCatalogs,
    dispose() {
      disposed = true;
      list.dispose();
    },
  };
}
