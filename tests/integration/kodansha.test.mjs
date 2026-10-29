import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  kodanshaBook,
  kodanshaListings,
  kodanshaSeriesPage,
  KODANSHA,
  KODANSHA_RELEASES,
} from "../../lib/domain/kodansha.ts";
import {
  safeCoverUrl,
  safeProductUrl,
  safeSeriesCatalogUrl,
  publisherKey,
} from "../../lib/domain/urls.ts";
import {
  publisherKey as clientPublisherKey,
  matchRelease,
  discoverTitles,
} from "../../lib/client/matching.ts";
import { releaseItem } from "../../lib/domain/releases.ts";
import { kodansha } from "../../lib/server/scrapers/kodansha.ts";
import { hanmoto } from "../../lib/server/scrapers/hanmoto.ts";
import { SCRAPER_SOURCES } from "../../lib/server/scrapers/registry.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { openStore } from "../../lib/server/store.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import { createCoverService } from "../../lib/server/covers.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/kodansha-" + name, import.meta.url),
    "utf8",
  );
const product = fixture("product.html"),
  isbn = "9784065134009";
const productUrl = KODANSHA + "/comic/products/0000314505";
const seriesUrl = KODANSHA + "/titles/1000033206";
const searchUrl = KODANSHA + "/products/search?keywords=" + isbn;
const seriesSpec = {
  series: "Blue Lock",
  type: "Manga (JP)",
  publisherId: "kodansha",
};
const searchHtml = `<main><strong>1件</strong><a class="app-product-list-item" href="${productUrl}"><strong>ブルーロック（１）</strong></a></main>`;
function database(t) {
  const store = openStore(":memory:");
  t.after(() => store.close());
  return store;
}
function response(url) {
  if (url === productUrl) return new Response(product);
  if (url === searchUrl) return new Response(searchHtml);
  if (url === seriesUrl) return new Response(fixture("series.html"));
  if (url.startsWith(seriesUrl + "/api?count="))
    return new Response(
      fixture("series-" + new URL(url).searchParams.get("count") + ".json"),
    );
  if (url === KODANSHA_RELEASES || url === KODANSHA_RELEASES + "?page=2")
    return new Response(
      fixture(url.endsWith("=2") ? "releases-2.html" : "releases.html"),
    );
  assert.fail("Unexpected request: " + url);
}

test("Kodansha is registered and shares Japanese publisher aliases without matching English editions", () => {
  assert.ok(SCRAPER_SOURCES.includes(kodansha));
  const item = releaseItem(
    "kodansha",
    "ブルーロック（１）",
    productUrl,
    "",
    isbn,
  );
  for (const publisher of [
    "Kodansha",
    "Kodansha JP",
    "Kodansha Japan",
    "講談社",
  ]) {
    assert.equal(publisherKey(publisher), "kodansha");
    assert.equal(clientPublisherKey(publisher), "kodansha");
  }
  assert.equal(item.series, "ブルーロック");
  assert.equal(item.volume, 1);
  assert.equal(item.type, "Manga (JP)");
  const book = { ...item, publisher: "講談社", isbn: "", type: "Manga (EN)" };
  assert.equal(matchRelease(item, [book]).possible.length, 0);
  assert.equal(discoverTitles([item], [book]).length, 1);
  assert.equal(
    discoverTitles([item], [{ ...book, type: "Manga (JP)" }]).length,
    0,
  );
});

test("Kodansha verifies its print ISBN, product identity, release date and matching cover", () => {
  const book = kodanshaBook(product, isbn, productUrl);
  assert.equal(book.isbn, isbn);
  assert.equal(book.series, "ブルーロック");
  assert.equal(book.authors, "金城 宗幸, ノ村 優介");
  assert.equal(book.releaseDate, "2018-11-16");
  assert.equal(book.price, "");
  assert.equal(book.source, "Kodansha JP");
  assert.match(book.coverUrl, /\/0000314505\//);
  assert.equal(kodanshaBook(product, "9784065203385", productUrl), null);
  assert.throws(
    () =>
      kodanshaBook(
        product.replace(
          'content="' + productUrl,
          'content="' + KODANSHA + "/comic/products/0000000001",
        ),
        isbn,
        productUrl,
      ),
    /identity/,
  );
  assert.throws(
    () =>
      kodanshaBook(
        product.replace(/<h4>紙版<\/h4>/, "<h4>電子版</h4>"),
        isbn,
        productUrl,
      ),
    /print edition/,
  );
  const electronic = product.replace(
    "</main>",
    "<h4>電子版</h4><h5>発売日</h5><p>2026年10月30日</p><h5>ISBN</h5><p>9784065203385</p></main>",
  );
  assert.equal(
    kodanshaBook(electronic, isbn, productUrl).releaseDate,
    "2018-11-16",
  );
  const wrongCover = product.replaceAll(
    "/0000314505/rkgan",
    "/0000000001/rkgan",
  );
  assert.equal(kodanshaBook(wrongCover, isbn, productUrl).coverUrl, "");
});

test("Kodansha URL allowlists reject unsafe hosts, credentials, paths and placeholders", () => {
  assert.equal(
    safeSeriesCatalogUrl(seriesUrl + "#publications", "kodansha"),
    seriesUrl,
  );
  assert.equal(safeProductUrl(productUrl, "kodansha"), productUrl);
  for (const url of [
    seriesUrl + "?url=https://evil.test",
    seriesUrl.replace("www.kodansha.co.jp", "www.kodansha.co.jp.evil.test"),
    seriesUrl.replace("https://", "http://"),
    seriesUrl.replace("https://", "https://user@"),
    seriesUrl + "/api?count=0",
  ])
    assert.equal(safeSeriesCatalogUrl(url, "kodansha"), "");
  for (const url of [
    "https://dvs-cover.kodansha.co.jp/logo.jpg",
    "https://dvs-cover.kodansha.co.jp/0000314505/../logo.jpg",
    "https://evil.test/0000314505/cover.jpg",
    "https://user@dvs-cover.kodansha.co.jp/0000314505/cover.jpg",
  ])
    assert.equal(safeCoverUrl(url), "");
});

test("Kodansha omits digital-only books and flags Japanese special editions and bundles", () => {
  const page = kodanshaSeriesPage(JSON.parse(fixture("series-0.json")));
  assert.equal(page.ids.length, 18);
  assert.equal(page.items.length, 17);
  assert.ok(page.more);
  assert.equal(
    page.items.find((item) => item.title.includes("セット")).bundle,
    true,
  );
  assert.equal(
    page.items.find((item) => item.title.includes("特装版")).special,
    true,
  );
  assert.ok(page.items.filter((item) => item.type === "Other").length);
  const html = searchHtml.replace("</a>", "<span>電子のみ</span></a>");
  assert.deepEqual(kodanshaListings(html).items, []);
  assert.throws(() => kodanshaListings("<h1>Maintenance</h1>"), /unavailable/);
  assert.throws(
    () => kodanshaSeriesPage({ products: [], productsCount: 20 }),
    /changed/,
  );
});

test("Kodansha releases load both print pages, save and reuse cached results during outages", async (t) => {
  const store = database(t),
    calls = [];
  let offline = false;
  const service = createCatalogService(
    store,
    async (url) => {
      calls.push(url);
      return offline ? new Response("Offline", { status: 503 }) : response(url);
    },
    [kodansha],
  );
  const releases = await service.getPublisherReleases({
    publisherId: "kodansha",
  });
  assert.equal(releases.items.length, 40);
  assert.equal(new Set(releases.items.map((item) => item.id)).size, 40);
  assert.ok(
    releases.items.every((item) => item.price === "" && item.isbn === ""),
  );
  store.api.setSavedRelease({ release: releases.items[0], saved: true });
  assert.equal(
    store.api.getCollection().savedReleases[0].publisherId,
    "kodansha",
  );
  await service.getPublisherReleases({ publisherId: "kodansha" });
  assert.equal(calls.length, 2);
  offline = true;
  const stale = await service.getPublisherReleases({
    publisherId: "kodansha",
    refresh: true,
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.checkedAt, releases.checkedAt);
  assert.deepEqual(stale.items, releases.items);
  const discovery = await createCatalogService(store, response, [
    kodansha,
  ]).getPublisherDirectory({ url: KODANSHA_RELEASES });
  assert.equal(discovery.items.length, 40);
  assert.equal(discovery.complete, false);
});

test("Kodansha series links traverse every page and count digital records without offering them", async (t) => {
  const store = database(t),
    calls = [];
  const service = createCatalogService(
    store,
    async (url) => {
      calls.push(url);
      return response(url);
    },
    [kodansha],
  );
  const selection = await service.getSeriesCatalog(seriesSpec);
  assert.equal(selection.needsSelection, true);
  assert.equal(selection.stale, false);
  assert.deepEqual(calls, []);
  store.api.setSeriesCatalog({
    ...seriesSpec,
    url: seriesUrl + "#publications",
  });
  const catalog = await service.getSeriesCatalog(seriesSpec);
  assert.equal(catalog.complete, true);
  assert.equal(catalog.total, 86);
  assert.equal(catalog.pages, 5);
  assert.ok(catalog.items.length < 86);
  const first = catalog.items.find((item) => item.url === productUrl);
  assert.equal(first.volume, 1);
  assert.equal(first.type, "Manga (JP)");
  assert.equal(first.catalogSeries, "Blue Lock");
  assert.equal(first.catalogVariant, false);
  assert.ok(catalog.items.some((item) => item.catalogVariant));
  await createCatalogService(store, () => assert.fail("Use durable catalog"), [
    kodansha,
  ]).getSeriesCatalog(seriesSpec);
  assert.equal(calls.length, 6);
});

test("Kodansha retains complete catalogs after repeated, malformed or failed continuation pages", async (t) => {
  for (const kind of ["repeated", "malformed", "offline"]) {
    const store = database(t);
    store.api.setSeriesCatalog({ ...seriesSpec, url: seriesUrl });
    let broken = false;
    const service = createCatalogService(
      store,
      async (url) => {
        if (broken && url === seriesUrl + "/api?count=1")
          return kind === "repeated"
            ? response(seriesUrl + "/api?count=0")
            : kind === "malformed"
              ? Response.json({ products: [] })
              : new Response("Offline", { status: 503 });
        return response(url);
      },
      [kodansha],
    );
    const complete = await service.getSeriesCatalog(seriesSpec);
    broken = true;
    const stale = await service.getSeriesCatalog({
      ...seriesSpec,
      refresh: true,
    });
    assert.equal(stale.stale, true, kind);
    assert.equal(stale.complete, true, kind);
    assert.equal(stale.checkedAt, complete.checkedAt);
    assert.deepEqual(stale.items, complete.items);
  }
});

test("Kodansha ISBN lookup shares canonical cache entries, verifies candidates and bypasses old misses", async (t) => {
  const store = database(t),
    calls = [];
  store.cache.put("isbn:v11:" + isbn, JSON.stringify({ found: false }), 86400);
  const service = createCatalogService(
    store,
    async (url, options) => {
      calls.push(url);
      assert.equal(options.cache, "no-store");
      return response(url);
    },
    [kodansha],
  );
  const [lookup, search] = await Promise.all([
    service.lookupIsbn("4065134005"),
    service.searchPublisherIsbn({ publisherId: "kodansha", isbn }),
  ]);
  assert.equal(lookup.details.source, "Kodansha JP");
  assert.equal(search.items[0].isbn, isbn);
  assert.deepEqual(calls, [searchUrl, productUrl]);
  const offline = createCatalogService(
    store,
    () => assert.fail("Use durable ISBN details"),
    [kodansha],
  );
  assert.equal(
    (
      await offline.searchPublisherIsbn({
        publisherId: "kodansha",
        isbn: "978-4-06-513400-9",
      })
    ).items[0].isbn,
    isbn,
  );
  assert.equal((await offline.lookupIsbn("9780385496490")).found, false);
});

test("Kodansha search challenges remain errors with a durable cooldown and Hanmoto fallback", async (t) => {
  const store = database(t),
    calls = [];
  const service = createCatalogService(
    store,
    async (url) => {
      calls.push(url);
      if (url === searchUrl) return new Response(null, { status: 202 });
      return new Response(
        readFileSync(
          new URL(
            "../fixtures/publishers/hanmoto-domestic-1.html",
            import.meta.url,
          ),
          "utf8",
        ).replaceAll("9784063951370", isbn),
      );
    },
    [kodansha, hanmoto],
  );
  const result = await service.lookupIsbn(isbn);
  assert.equal(result.details.source, "Hanmoto");
  assert.deepEqual(result.warnings, ["Kodansha JP is unavailable right now."]);
  await assert.rejects(
    () =>
      service.searchPublisherIsbn({
        publisherId: "kodansha",
        isbn,
        refresh: true,
      }),
    /cooldown/,
  );
  assert.equal(calls.filter((url) => url === searchUrl).length, 1);
});

test("Kodansha product galleries verify the selected ISBN before offering a cover", async (t) => {
  const store = database(t);
  store.api.saveBook({
    requestId: "kodansha_cover",
    book: {
      series: "Blue Lock",
      type: "Manga (JP)",
      publisher: "Kodansha",
      volume: 1,
      status: "Read",
      isbn,
      publisherUrl: productUrl,
    },
  });
  const service = createCatalogService(store, response, [kodansha]);
  const covers = await service.getBookCoverOptions({ row: 1 });
  assert.equal(covers.covers.length, 1);
  assert.equal(covers.covers[0].source, "Kodansha JP");
  assert.equal(covers.covers[0].publisherUrl, productUrl);
  const wrong = createCatalogService(
    store,
    () => new Response(product.replaceAll(isbn, "9784065203385")),
    [kodansha],
  );
  assert.deepEqual(
    (await wrong.getBookCoverOptions({ row: 1, refresh: true })).covers,
    [],
  );
});

test("Kodansha covers use permanent image storage and survive an offline application restart", async (t) => {
  const store = database(t),
    calls = [];
  const image = kodanshaBook(product, isbn, productUrl).coverUrl;
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  store.api.saveBook({
    requestId: "kodansha_stored_cover",
    book: {
      series: "Blue Lock",
      publisher: "Kodansha JP",
      type: "Manga (JP)",
      volume: 1,
      status: "Read",
      isbn,
      publisherUrl: productUrl,
    },
  });
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === image) return new Response(bytes);
    if (url === searchUrl || url === productUrl) return response(url);
    return new Response("Missing", { status: 404 });
  };
  const covers = createCoverService(store, { fetchImpl });
  const api = createApplicationApi(store, covers, fetchImpl);
  const choice = (await api.getBookCoverOptions({ row: 1 })).covers[0];
  assert.equal(choice.source, "Kodansha JP");
  assert.deepEqual(covers.get(choice.coverId).body, bytes);
  const automatic = await api.getBookCover({ row: 1 });
  assert.equal(automatic.coverId, choice.coverId);
  assert.equal(calls.filter((url) => url === image).length, 1);
  const offline = createApplicationApi(store, covers, () =>
    assert.fail("Use stored image bytes"),
  );
  assert.equal(
    (await offline.getBookCover({ row: 1 })).coverId,
    choice.coverId,
  );
  assert.equal(store.api.getCollection().books[0].publisherUrl, productUrl);
});
