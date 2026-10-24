import {
  animeCatalogTitleKeys,
  matchAnimeCatalogTitle,
  type SeasonalThaiFeed,
} from "../domain/anime.ts";
import type { Release } from "../types.ts";
import type { createAnimeService } from "./anime.ts";
import type { createCatalogService } from "./catalogs.ts";

const sources = [
  {
    publisher: "Phoenix Next",
    url: "https://www.phoenixnext.com/book-series.html",
  },
  { publisher: "First Page Pro", url: "https://www.firstpagepro.com/" },
  { publisher: "Animag", url: "https://www.animagshop.com/" },
];

function representative(a: Release, b: Release) {
  const rank = (item: Release) =>
    item.volume === 1 ? 0 : item.volume === "" ? Infinity : Number(item.volume);
  return rank(a) - rank(b) || a.title.localeCompare(b.title);
}

export function createSeasonalDiscoveryService(
  anime: ReturnType<typeof createAnimeService>,
  catalogs: Pick<
    ReturnType<typeof createCatalogService>,
    "getPublisherDirectory" | "getPublisherCatalog"
  >,
) {
  return {
    async getSeasonalThaiBooks(arg?: unknown): Promise<SeasonalThaiFeed> {
      // Validate the season before requesting any publisher data.
      const feed = await anime.getSeasonalAnimeBooks(arg);
      const refresh =
        (arg as { refresh?: boolean } | undefined)?.refresh === true;
      const items = feed.items.map((item) => ({
        ...item,
        thaiEditions: [],
      })) as SeasonalThaiFeed["items"];
      const thaiSources: SeasonalThaiFeed["thaiSources"] = [];
      if (!items.length) return { ...feed, items, thaiSources };

      await Promise.all(
        sources.map(async (source, index) => {
          const coverage = {
            ...source,
            checkedAt: "",
            stale: false,
            complete: true,
            error: "",
          };
          thaiSources[index] = coverage;
          try {
            const directory = await catalogs.getPublisherDirectory({
              url: source.url,
              refresh,
            });
            coverage.checkedAt = directory.checkedAt;
            coverage.stale = directory.stale;
            coverage.error = directory.error || "";
            coverage.complete = !directory.stale && !directory.error;
            const titles = (directory.titles || []).filter((title) =>
              items.some(({ book }) => matchAnimeCatalogTitle(book, title)),
            );
            // Only matched categories are fetched, with three checks per source.
            let cursor = 0;
            await Promise.all(
              Array.from({ length: Math.min(3, titles.length) }, async () => {
                while (cursor < titles.length) {
                  const title = titles[cursor++];
                  const titleKeys = animeCatalogTitleKeys(title.series);
                  for (const category of title.categories) {
                    try {
                      const catalog = await catalogs.getPublisherCatalog({
                        url: category.url,
                        refresh,
                      });
                      if (catalog.stale || !catalog.complete || catalog.error) {
                        coverage.stale ||= catalog.stale;
                        coverage.complete = false;
                        coverage.error ||=
                          catalog.error ||
                          "Some matching title categories could not be fully checked.";
                      }
                      const listings = catalog.items
                        .map((item) => ({
                          ...item,
                          type: item.type || category.type || title.type,
                        }))
                        .filter(
                          (item) =>
                            !item.special &&
                            !item.bundle &&
                            ["Manga (TH)", "LN (TH)"].includes(item.type),
                        )
                        .sort(representative);
                      for (const listing of listings) {
                        // Categories can include related series. A listing must share
                        // the directory title or one of the book's own aliases.
                        const matches = items.flatMap((item) => {
                          const evidence = matchAnimeCatalogTitle(item.book, {
                            ...title,
                            type: listing.type,
                          });
                          if (!evidence) return [];
                          const sameTitle = [
                            ...animeCatalogTitleKeys(listing.series),
                          ].some((key) => titleKeys.has(key));
                          return sameTitle ||
                            matchAnimeCatalogTitle(item.book, listing)
                            ? [{ item, evidence }]
                            : [];
                        });
                        // An alias shared by several book records needs manual review.
                        if (matches.length !== 1) continue;
                        const { item, evidence } = matches[0];
                        const existing = item.thaiEditions.findIndex(
                          (edition) =>
                            edition.item.publisherId === listing.publisherId &&
                            edition.item.type === listing.type,
                        );
                        if (existing !== -1) {
                          const previous = item.thaiEditions[existing];
                          if (
                            Number(previous.stale) <
                              Number(directory.stale || catalog.stale) ||
                            (previous.stale ===
                              (directory.stale || catalog.stale) &&
                              representative(previous.item, listing) <= 0)
                          )
                            continue;
                          item.thaiEditions.splice(existing, 1);
                        }
                        item.thaiEditions.push({
                          item: listing,
                          ...evidence,
                          checkedAt: catalog.checkedAt,
                          stale: directory.stale || catalog.stale,
                        });
                      }
                    } catch {
                      coverage.complete = false;
                      coverage.error ||=
                        "Some matching title categories could not be checked.";
                    }
                  }
                }
              }),
            );
          } catch {
            coverage.complete = false;
            coverage.error = "The publisher directory could not be checked.";
          }
        }),
      );
      for (const item of items)
        item.thaiEditions.sort((a, b) =>
          a.item.publisher.localeCompare(b.item.publisher),
        );
      return { ...feed, items, thaiSources };
    },
  };
}
