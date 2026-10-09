import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../lib/server/store.mjs";
import { createCatalogService } from "../../lib/server/catalogs.mjs";
import {
  parseCatalog_,
  parseSeriesCategories_,
  matchSeriesCategory_,
} from "../../lib/domain.mjs";
const fixture = (name) =>
  readFileSync(new URL("../fixtures/" + name, import.meta.url), "utf8");
function remote(entries, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    const item = entries.find((item) => url.includes(item.match));
    return new Response(item?.text ?? JSON.stringify(item?.data || {}), {
      status: item?.status || 200,
      headers: item?.headers,
    });
  };
}
const series = "ดอกรักผลิบานที่กลางใจ",
  category =
    "https://www.phoenixnext.com/book-series/kaoru-hana-wa-rin-to-saku.html";

test("Node scrapers parse real publisher fixtures, follow pagination and keep durable stale results after restart", async () => {
  const path = join(
      mkdtempSync(join(tmpdir(), "books-cache-")),
      "books.sqlite",
    ),
    calls = [];
  let store = openStore(path),
    entries = [
      { match: "phoenixnext", text: fixture("publishers/phoenix.html") },
    ];
  let service = createCatalogService(store, remote(entries, calls));
  const fresh = await service.getPublisherReleases({ publisherId: "phoenix" });
  assert.equal(fresh.items.length, 3);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.endsWith("?p=2"));
  await service.getPublisherReleases({ publisherId: "phoenix" });
  assert.equal(calls.length, 2);
  store.close();
  store = openStore(path);
  service = createCatalogService(
    store,
    remote([{ match: "phoenixnext", status: 503 }]),
  );
  try {
    const stale = await service.getPublisherReleases({
      publisherId: "phoenix",
      refresh: true,
    });
    assert.equal(stale.stale, true);
    assert.equal(stale.checkedAt, fresh.checkedAt);
    assert.equal(stale.items.length, 3);
  } finally {
    store.close();
  }
});

test("full series catalogs work independently of recent releases and explicit links persist by edition", async () => {
  const store = openStore(":memory:"),
    calls = [];
  const service = createCatalogService(
    store,
    remote(
      [
        {
          match: "book-series.html",
          text: fixture("series-catalogs/phoenix-directory.html"),
        },
        {
          match: "kaoru-hana-wa-rin-to-saku.html",
          text: fixture("series-catalogs/phoenix-category.html"),
        },
      ],
      calls,
    ),
  );
  try {
    const result = await service.getSeriesCatalog({
      series,
      publisherId: "phoenix",
      type: "Manga (TH)",
    });
    assert.equal(result.complete, true);
    assert.equal(result.items.length, 32);
    assert.equal(result.total, 32);
    assert.ok(calls.every((call) => !call.url.includes("new-release")));
    const spec = {
      series: "My English title",
      publisherId: "phoenix",
      type: "Manga (TH)",
    };
    store.api.setSeriesCatalog({ ...spec, url: category, title: series });
    const linked = await service.getSeriesCatalog(spec);
    assert.equal(linked.complete, true);
    assert.equal(linked.items[0].catalogSeries, spec.series);
    assert.equal(store.savedSeriesCatalog({ ...spec, type: "LN (TH)" }), null);
    const unknown = await service.getSeriesCatalog({
      ...spec,
      series: "Unknown name",
    });
    assert.equal(unknown.needsSelection, true);
    assert.equal(unknown.complete, false);
    for (const url of [
      "https://evil.test/a",
      "http://www.phoenixnext.com/book-series/a.html",
      "https://www.phoenixnext.com.evil.test/book-series/a.html",
    ])
      assert.throws(
        () => store.api.setSeriesCatalog({ ...spec, url }),
        /category URL/,
      );
  } finally {
    store.close();
  }
});

test("Luckpim Node requests carry cookies and tokens, retain stock, preorder labels and full search results", async () => {
  const store = openStore(":memory:"),
    calls = [],
    entries = [
      {
        match: "get/search_pin/key",
        data: JSON.parse(fixture("series-catalogs/luckpim-series.json")),
      },
      {
        match: "getBookList",
        data: JSON.parse(fixture("publishers/luckpim.json")),
      },
      {
        match: "luckpim.com/",
        text: "<input name=__RequestVerificationToken value=public-token>",
        headers: { "Set-Cookie": "catalog-session=test; Path=/" },
      },
    ];
  const service = createCatalogService(store, remote(entries, calls));
  try {
    const feed = await service.getPublisherReleases({ publisherId: "luckpim" });
    assert.equal(feed.items.length, 4);
    assert.equal(feed.items[1].availability, "Pre-order");
    assert.equal(calls[1].options.headers.Cookie, "catalog-session=test");
    assert.equal(calls[1].options.headers["XSRF-TOKEN"], "public-token");
    const result = await service.getSeriesCatalog({
      publisherId: "luckpim",
      series: "เกมสารภาพรักนี้น่ะ เรามาจบมันกันเถอะ",
      type: "Manga (TH)",
    });
    assert.equal(result.complete, true);
    assert.equal(result.items.length, 7);
    assert.ok(calls.some((call) => call.url.includes("limit=-1")));
  } finally {
    store.close();
  }
});

test("Naiin verifies the exact edition; Google Books fallback checks ISBN equivalence", async () => {
  const store = openStore(":memory:"),
    calls = [],
    entries = [
      { match: "search-result", text: fixture("publishers/naiin-search.html") },
      {
        match: "product/detail/716295",
        text: fixture("publishers/naiin-detail.html"),
      },
      {
        match: "googleapis",
        data: {
          items: [
            {
              volumeInfo: {
                title: "Matilda",
                industryIdentifiers: [{ identifier: "0140328726" }],
              },
            },
          ],
        },
      },
    ];
  const service = createCatalogService(store, remote(entries, calls));
  try {
    const exact = await service.lookupIsbn("9786166247275");
    assert.equal(exact.details.source, "Naiin");
    assert.equal(exact.details.volume, 22);
    await service.lookupIsbn("9786166247275");
    assert.equal(calls.length, 2);
    const other = await service.lookupIsbn("9780140328721");
    assert.equal(other.details.source, "Google Books");
    assert.equal(other.details.title, "Matilda");
  } finally {
    store.close();
  }
});

test("publisher categories distinguish light novels from manga without guessing translations", () => {
  const categories = parseSeriesCategories_(
    "firstpage",
    fixture("series-catalogs/firstpage-directory.html"),
  );
  const manga = matchSeriesCategory_(
      "ผู้กล้าโล่ผงาด",
      categories,
      "Manga (TH)",
    ),
    novel = matchSeriesCategory_("ผู้กล้าโล่ผงาด", categories, "LN (TH)");
  assert.notEqual(manga.url, novel.url);
  assert.equal(matchSeriesCategory_("ผู้กล้าโล่ผงาด", categories), null);
  assert.deepEqual(
    parseCatalog_(
      "phoenix",
      '<a class="product-item-link" href="https://evil.test/book.html">Unsafe</a>',
    ),
    [],
  );
});
