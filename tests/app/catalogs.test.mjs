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
  digest_,
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
    assert.equal(result.items.length, 28);
    assert.equal(result.total, 32);
    assert.ok(
      result.items
        .filter((item) => item.special && !item.bundle)
        .every((item) => !item.catalogVariant && item.series === series),
    );
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

test("parser fixes apply to durable catalogs from before the update, including outage fallbacks", async () => {
  const store = openStore(":memory:");
  const items = parseCatalog_(
    "phoenix",
    fixture("series-catalogs/phoenix-category.html"),
  );
  const previous = {
    publisherId: "phoenix",
    series,
    type: "Manga (TH)",
    title: series,
    url: category,
    items: items.map((item) => {
      const old = { ...item };
      delete old.bundle;
      if (old.special) {
        old.series = "Special Set " + series;
        old.catalogVariant = true;
      }
      return old;
    }),
    checkedAt: new Date().toISOString(),
    complete: true,
    stale: false,
    error: "",
  };
  const key = "series:v1:phoenix:" + digest_(series + "\nManga (TH)\n");
  store.cache.put(key, JSON.stringify(previous), 604800);
  store.cache.put("releases:v1:phoenix", JSON.stringify(previous), 604800);
  const service = createCatalogService(
    store,
    remote([{ match: "phoenixnext", status: 503 }]),
  );
  try {
    const fresh = await service.getSeriesCatalog({
      series,
      publisherId: "phoenix",
      type: "Manga (TH)",
    });
    assert.ok(fresh.items.every((item) => !item.title.includes("Special Set")));
    const stale = await service.getSeriesCatalog({
      series,
      publisherId: "phoenix",
      type: "Manga (TH)",
      refresh: true,
    });
    assert.equal(stale.stale, true);
    assert.equal(stale.checkedAt, previous.checkedAt);
    assert.ok(stale.items.every((item) => !item.title.includes("Special Set")));
    const releases = await service.getPublisherReleases({
      publisherId: "phoenix",
      refresh: true,
    });
    assert.equal(releases.stale, true);
    assert.ok(
      releases.items.every((item) => !item.title.includes("Special Set")),
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
    assert.equal(feed.items.length, 3);
    assert.equal(feed.items[1].availability, "Pre-order");
    assert.equal(calls[1].options.headers.Cookie, "catalog-session=test");
    assert.equal(calls[1].options.headers["XSRF-TOKEN"], "public-token");
    const result = await service.getSeriesCatalog({
      publisherId: "luckpim",
      series: "เกมสารภาพรักนี้น่ะ เรามาจบมันกันเถอะ",
      type: "Manga (TH)",
    });
    assert.equal(result.complete, true);
    assert.equal(result.items.length, 6);
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

test("First Page categories named after volume 1 match the shelf series without guessing titles", async () => {
  const store = openStore(":memory:");
  const categories = parseSeriesCategories_(
    "firstpage",
    fixture("series-catalogs/firstpage-directory.html"),
  );
  const numbered = categories.find((entry) => entry.url.endsWith("/135"));
  const series = numbered.title.replace(/ เล่ม 01$/, "");
  const spec = { publisherId: "firstpage", type: "Manga (TH)", series };
  const service = createCatalogService(
    store,
    remote([
      {
        match: "category/135",
        text: fixture("series-catalogs/firstpage-numbered-category.html"),
      },
      {
        match: "firstpagepro.com/",
        text: fixture("series-catalogs/firstpage-directory.html"),
      },
    ]),
  );
  try {
    assert.equal(
      matchSeriesCategory_(series, categories, spec.type).url,
      numbered.url,
    );
    assert.equal(
      matchSeriesCategory_(
        series,
        [numbered, { ...numbered, url: numbered.url + "0" }],
        spec.type,
      ),
      null,
    );
    assert.equal(
      matchSeriesCategory_(
        "เรื่อง 86",
        [{ title: "เรื่อง 86 เล่ม 01", type: spec.type }],
        spec.type,
      )?.title,
      "เรื่อง 86 เล่ม 01",
    );
    const result = await service.getSeriesCatalog(spec);
    assert.equal(result.complete, true);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].volume, 1);
    assert.equal(result.items[0].catalogVariant, false);

    // A manually linked shelf alias must also compare against the category's series name.
    const alias = { ...spec, series: "My shelf alias" };
    store.api.setSeriesCatalog({
      ...alias,
      url: numbered.url,
      title: numbered.title,
    });
    const linked = await service.getSeriesCatalog(alias);
    assert.equal(linked.items[0].catalogSeries, alias.series);
    assert.equal(linked.items[0].catalogVariant, false);
    const cached = await service.getSeriesCatalog(alias);
    assert.equal(cached.items[0].catalogVariant, false);
  } finally {
    store.close();
  }
});

test("Refresh catalog rechecks First Page's directory after a category could not be matched", async () => {
  const store = openStore(":memory:");
  const directory = fixture("series-catalogs/firstpage-directory.html");
  const entries = [
    {
      match: "category/56",
      text: fixture("series-catalogs/firstpage-category.html"),
    },
    {
      match: "firstpagepro.com/",
      text: directory.replaceAll(
        "ชิชุนกิจัง สาวใสวัยลองรัก",
        "Old category title",
      ),
    },
  ];
  const calls = [];
  const service = createCatalogService(store, remote(entries, calls));
  const spec = {
    publisherId: "firstpage",
    series: "ชิชุนกิจัง สาวใสวัยลองรัก",
    type: "Manga (TH)",
  };
  try {
    const unmatched = await service.getSeriesCatalog(spec);
    assert.equal(unmatched.needsSelection, true);
    entries[1].text = directory;
    const refreshed = await service.getSeriesCatalog({
      ...spec,
      refresh: true,
    });
    assert.equal(refreshed.complete, true);
    assert.equal(refreshed.items.length, 11);
    assert.equal(
      calls.filter(({ url }) => url === "https://www.firstpagepro.com/").length,
      2,
    );
  } finally {
    store.close();
  }
});
