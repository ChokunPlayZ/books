import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../../lib/server/store.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import { createSeasonalDiscoveryService } from "../../lib/server/seasonal-discovery.ts";
import { seasonalFeed, seasonMedia } from "../helpers/anime.mjs";
import { releaseItem } from "../../lib/domain/releases.ts";

const category = "https://www.phoenixnext.com/book-series/moonlit-library.html";
const title = {
  series: "ห้องสมุดใต้แสงจันทร์",
  title: "ห้องสมุดใต้แสงจันทร์",
  type: "",
  url: category,
  categories: [{ url: category }],
};
const listing = (name, type = "Manga (TH)") =>
  releaseItem(
    "phoenix",
    name,
    "https://www.phoenixnext.com/volume.html",
    175,
    "9780140328721",
    type,
  );

test("seasonal discovery checks real Thai listings, deduplicates editions, separates formats and preserves coverage during outages", async () => {
  const calls = [];
  const manga = listing("(มังงะ) ห้องสมุดใต้แสงจันทร์ เล่ม 1");
  const service = createSeasonalDiscoveryService(
    {
      getSeasonalAnimeBooks: async () => structuredClone(seasonalFeed),
    },
    {
      getPublisherDirectory: async ({ url }) => {
        if (url.includes("firstpage")) throw new Error("offline");
        return {
          titles: [title, { ...title, url: category + "?duplicate" }],
          checkedAt: seasonalFeed.checkedAt,
          stale: false,
        };
      },
      getPublisherCatalog: async (request) => {
        calls.push(request);
        return {
          items: [
            listing("(มังงะ) ห้องสมุดใต้แสงจันทร์ เล่ม 3"),
            listing("(นิยาย) ห้องสมุดใต้แสงจันทร์ เล่ม 1", "LN (TH)"),
            listing("(มังงะ) ห้องสมุดใต้แสงจันทร์ ภาคใหม่ เล่ม 1"),
            { ...manga, special: true },
            manga,
          ],
          checkedAt: seasonalFeed.checkedAt,
          stale: true,
          complete: true,
          error: "Showing the previous check.",
        };
      },
    },
  );
  const feed = await service.getSeasonalThaiBooks({ refresh: true });
  const editions = feed.items.flatMap((item) => item.thaiEditions);
  assert.equal(editions.length, 1);
  assert.equal(editions[0].item.volume, 1);
  assert.equal(editions[0].item.isbn, "9780140328721");
  assert.equal(editions[0].stale, true);
  assert.equal(editions[0].checkedAt, seasonalFeed.checkedAt);
  assert.equal(feed.items[1].thaiEditions.length, 0);
  assert.equal(feed.thaiSources[0].complete, false);
  assert.equal(feed.thaiSources[0].stale, true);
  assert.match(feed.thaiSources[1].error, /directory could not be checked/);
  assert.ok(calls.every((request) => request.refresh));
});

test("a directory alone, empty categories, untyped listings and ambiguous aliases do not confirm a Thai translation", async () => {
  const book = seasonalFeed.items[0];
  for (const items of [[], [listing("ห้องสมุดใต้แสงจันทร์ เล่ม 1", "")]]) {
    const service = createSeasonalDiscoveryService(
      {
        getSeasonalAnimeBooks: async () => structuredClone(seasonalFeed),
      },
      {
        getPublisherDirectory: async () => ({
          titles: [title],
          checkedAt: seasonalFeed.checkedAt,
          stale: false,
        }),
        getPublisherCatalog: async () => ({
          items,
          complete: true,
          checkedAt: seasonalFeed.checkedAt,
          stale: false,
        }),
      },
    );
    assert.equal(
      (await service.getSeasonalThaiBooks()).items[0].thaiEditions.length,
      0,
    );
  }
  const ambiguous = createSeasonalDiscoveryService(
    {
      getSeasonalAnimeBooks: async () => ({
        ...structuredClone(seasonalFeed),
        items: [book, { ...book, book: { ...book.book, id: 999 } }],
      }),
    },
    {
      getPublisherDirectory: async () => ({
        titles: [title],
        checkedAt: seasonalFeed.checkedAt,
        stale: false,
      }),
      getPublisherCatalog: async () => ({
        items: [listing("ห้องสมุดใต้แสงจันทร์ เล่ม 1")],
        complete: true,
        checkedAt: seasonalFeed.checkedAt,
        stale: false,
      }),
    },
  );
  assert.equal(
    (await ambiguous.getSeasonalThaiBooks()).items.flatMap(
      (item) => item.thaiEditions,
    ).length,
    0,
  );
});

test("application API joins AniList and Thai publisher catalogs and reuses persistent caches", async () => {
  const store = openStore(":memory:");
  const calls = [];
  const api = createApplicationApi(
    store,
    { ensure: () => assert.fail("No images in fixture") },
    async (url, options) => {
      calls.push(url);
      if (url === "https://graphql.anilist.co") {
        assert.equal(JSON.parse(options.body).variables.season, "FALL");
        return Response.json({
          data: {
            Page: { media: seasonMedia, pageInfo: { hasNextPage: false } },
          },
        });
      }
      if (url === "https://www.phoenixnext.com/book-series.html")
        return new Response(`<a href="${category}">ห้องสมุดใต้แสงจันทร์</a>`);
      if (url === category)
        return new Response(
          '<span class="toolbar-number">1</span><a class="product-item-link" href="https://www.phoenixnext.com/moonlit-01.html">(มังงะ) ห้องสมุดใต้แสงจันทร์ เล่ม 1</a>',
        );
      if (url === "https://www.firstpagepro.com/")
        return new Response(
          '<a href="https://www.firstpagepro.com/category/101/light-novel/archivist">บรรณารักษ์คนสุดท้าย (The Last Archivist)</a>',
        );
      if (url === "https://www.firstpagepro.com/category/101")
        return new Response(
          '<span class="tsk-all">1</span><div class="productArea productItem"><a class="gadgetThumbnail" href="https://www.firstpagepro.com/product/501/archivist" title="นิยาย บรรณารักษ์คนสุดท้าย เล่ม 1"></a></div>',
        );
      assert.fail("Unexpected catalog fetch: " + url);
    },
  );
  try {
    await assert.rejects(api.getSeasonalThaiBooks({ year: "2026" }));
    assert.equal(calls.length, 0);
    const feed = await api.getSeasonalThaiBooks({ season: "FALL", year: 2026 });
    assert.equal(
      feed.items[0].thaiEditions[0].item.series,
      "ห้องสมุดใต้แสงจันทร์",
    );
    assert.equal(feed.items[0].thaiEditions[0].item.type, "Manga (TH)");
    assert.equal(feed.thaiSources.length, 2);
    assert.equal(feed.items[1].thaiEditions[0].item.publisherId, "firstpage");
    assert.equal(feed.items[1].thaiEditions[0].item.type, "LN (TH)");
    assert.equal(
      feed.items[1].thaiEditions[0].item.series,
      "บรรณารักษ์คนสุดท้าย",
    );
    assert.ok(feed.thaiSources.every((source) => source.complete));
    assert.equal(calls.length, 5);
    await api.getSeasonalThaiBooks({ season: "FALL", year: 2026 });
    assert.equal(
      calls.length,
      5,
      "AniList, directories and matching categories are cached",
    );
  } finally {
    store.close();
  }
});
