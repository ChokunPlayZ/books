import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  catalogTotal,
  parseCatalog,
  publisherKey,
  publisherCatalogSource,
  safeProductUrl,
  safeSeriesCatalogUrl,
  safePublisherUrl,
  releaseItem,
  splitDexpressTitle,
} from "../../lib/domain.ts";
import { dexpressProduct } from "../../lib/domain/dexpress.ts";
import { publisherCovers } from "../../lib/server/publisher-covers.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { createScraperContext } from "../../lib/server/scrapers/http.ts";
import { dexpress } from "../../lib/server/scrapers/dexpress.ts";
import { openStore } from "../../lib/server/store.ts";
import {
  discoverTitles,
  matchRelease,
  publisherKey as clientPublisherKey,
} from "../../lib/client/matching.ts";
import { collectionMissing } from "../../lib/client/missing-catalogs.ts";

const fixture = (name) =>
  readFileSync(
    new URL(
      "../fixtures/publishers/dexpress-" + name + ".html",
      import.meta.url,
    ),
    "utf8",
  );
const base = "https://www.dexpress-shop.com";
const isbn = "9786163634627";
const series = "เกิดชาตินี้พี่ต้องเทพ";
const spec = { publisherId: "dexpress", series, type: "LN (TH)" };
const productUrl = base + "/product/240";
const image = "https://cw.lnwfile.com/_/cw/_raw/zy/54/ml.jpg";
const book = { series, publisher: "DEX", type: "LN (TH)", volume: 1, isbn: "" };

function setup(t, respond, sources = [dexpress]) {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const calls = [];
  const remote = async (url, options) => {
    calls.push({ url, options });
    return respond(new URL(url), options);
  };
  return {
    store,
    calls,
    remote,
    service: createCatalogService(store, remote, sources),
  };
}
function seriesResponse(url) {
  assert.equal(url.searchParams.get("q"), series);
  assert.equal(url.pathname, "/search");
  return new Response(
    fixture(
      url.searchParams.get("category_id") === "2"
        ? "series-manga" + (url.searchParams.get("tskp") === "2" ? "-2" : "")
        : "series-novel",
    ),
  );
}

test("DEXpress aliases and catalog/product links stay on the allowed host and preserve variant identities", async (t) => {
  for (const name of [
    "DEXpress",
    "DEX PRESS",
    "DEX",
    "เดกซ์เพรส",
    "เดกซ์เพรสส์",
    "เด็กซ์เพรส",
  ]) {
    assert.equal(publisherKey(name), "dexpress");
    assert.equal(clientPublisherKey(name), "dexpress");
  }
  assert.equal(
    safeProductUrl(productUrl + "/ชื่อหนังสือ", "dexpress"),
    productUrl,
  );
  assert.equal(
    safeProductUrl(productUrl + "/ชื่อ?pid=241", "dexpress"),
    productUrl + "?pid=241",
  );
  assert.equal(
    safeSeriesCatalogUrl(base + "/category/3/นิยาย", "dexpress"),
    base + "/category/3",
  );
  assert.equal(publisherCatalogSource(base + "/").publisherId, "dexpress");
  assert.equal(
    safeSeriesCatalogUrl(base + "/search?q=เรื่องหนึ่ง", "dexpress"),
    base + "/search?q=" + encodeURIComponent("เรื่องหนึ่ง"),
  );
  for (const url of [
    "http://www.dexpress-shop.com/product/240",
    base + ":444/product/240",
    "https://user@www.dexpress-shop.com/product/240",
    "https://www.dexpress-shop.com.evil.test/product/240",
    productUrl + "?pid=2&pid=3",
    productUrl + "#isbn",
  ]) {
    assert.equal(safeProductUrl(url, "dexpress"), "");
  }
  for (const url of [
    base + "/search?q=x&q=y",
    base + "/search?q=x&redirect=evil",
    base + "/category/3?tskp=2",
    base + "/search?q=x#y",
  ])
    assert.equal(safeSeriesCatalogUrl(url, "dexpress"), "");
  assert.equal(safePublisherUrl("https://evil.test/book", "DEX"), "");
  const { store } = setup(t, () => assert.fail("No network request expected"));
  const context = createScraperContext(
    store.cache,
    async () =>
      new Response(null, {
        status: 301,
        headers: { location: productUrl + "/slug?pid=999" },
      }),
    [dexpress],
  );
  await assert.rejects(
    context.fetchText(productUrl + "?pid=241"),
    /Unsupported catalog redirect/,
  );
});

test("DEXpress live cards retain prices and formats; bundles, autograph slots and unknown ISBNs need review", () => {
  const novel = parseCatalog(
    "dexpress",
    fixture("series-novel"),
    base + "/search?q=x&category_id=3",
  );
  assert.equal(catalogTotal("dexpress", fixture("series-novel")), 26);
  assert.equal(novel.length, 26);
  assert.equal(novel[0].price, 299);
  assert.equal(novel[0].series, series);
  assert.equal(novel[0].volume, 24);
  assert.equal(novel[0].type, "LN (TH)");
  assert.equal(novel[0].isbn, "");
  for (const slot of novel.filter((item) => item.url.includes("?pid="))) {
    assert.equal(slot.volume, "");
    assert.equal(slot.type, "");
    assert.equal(slot.isbn, "");
    assert.equal(slot.special, true);
    assert.deepEqual(matchRelease(slot, [book]).possible, []);
  }
  const manga = parseCatalog(
    "dexpress",
    fixture("series-manga"),
    base + "/category/2",
  );
  assert.equal(manga[0].series, series);
  assert.equal(manga[0].type, "Manga (TH)");
  assert.equal(manga[0].availability, "In stock");
  assert.equal(
    splitDexpressTitle("[DEXPRESS] นิยาย เกมพลิกโฉมนายกระจอก Lv.5").volume,
    5,
  );
  assert.equal(
    splitDexpressTitle("[DEXPRESS] นิยาย เรื่องหนึ่ง เล่ม 14.5").volume,
    14.5,
  );
  assert.equal(
    splitDexpressTitle("[DEXPRESS] เรื่องหนึ่ง เล่มเดียวจบ ฉบับการ์ตูน").volume,
    1,
  );
  for (const title of [
    "[DEXPRESS] AUTOGRAPH SET " + series,
    "[DEXPRESS] นิยาย เรื่องหนึ่ง เล่ม 1-6 (แพ็คชุด)",
    "[DEXPRESS] นิยาย เรื่องหนึ่ง เล่ม 1 (แพ็กชุด)",
  ]) {
    const item = releaseItem("dexpress", title, productUrl, 100, isbn);
    assert.ok(item.bundle && item.special);
    assert.equal(item.isbn, "");
  }
  const discovery = discoverTitles([novel[0], manga[0]], []);
  assert.equal(discovery.length, 2);
  assert.deepEqual(
    discoverTitles([novel[0], manga[0]], [book]).map((item) => item.type),
    ["Manga (TH)"],
  );
});

test("DEXpress exact ISBNs and galleries come only from the main product JSON data", () => {
  const html = fixture("product");
  const { item } = dexpressProduct(html, productUrl);
  assert.equal(item.isbn, isbn);
  assert.equal(item.type, "LN (TH)");
  assert.equal(item.price, 264);
  assert.equal(item.coverUrl, image);
  const recommendation =
    '<script type="application/ld+json">' +
    JSON.stringify({
      sku: isbn,
      image: "https://cw.lnwfile.com/unrelated.jpg",
    }) +
    "</script>";
  assert.deepEqual(publisherCovers(html + recommendation, productUrl), [image]);
  assert.throws(
    () => dexpressProduct(html, base + "/product/241"),
    /could not be read/,
  );
  assert.throws(
    () =>
      dexpressProduct(html.replace('"has_sub":0', '"has_sub":1'), productUrl),
    /variants require review/,
  );
  assert.equal(
    dexpressProduct(
      html.replace(isbn, "SKU-00240") + recommendation,
      productUrl,
    ).item.isbn,
    "",
  );
  assert.throws(
    () =>
      dexpressProduct(
        "<script>var payload = window.pdata;</script>",
        productUrl,
      ),
    /could not be read/,
  );
});

test("DEXpress series checks traverse both formats with query-safe pagination, cache pages and retain complete results during outages", async (t) => {
  let fail = false;
  const { service, store, calls, remote } = setup(t, (url) =>
    fail ? new Response("Unavailable", { status: 503 }) : seriesResponse(url),
  );
  const result = await service.getSeriesCatalog(spec);
  assert.equal(result.complete, true);
  assert.equal(result.total, 57);
  assert.equal(result.items.length, 57);
  assert.equal(result.pages, 3);
  assert.ok(
    result.items.some(
      (item) => item.catalogVariant && /ร็อกซี/.test(item.title),
    ),
  );
  assert.ok(
    result.items.some((item) => item.type === "LN (TH)" && item.volume === 1),
  );
  assert.ok(calls.some(({ url }) => url.includes("&category_id=2&tskp=2")));
  assert.equal(
    collectionMissing([book], [{ ...spec, feed: result }]).length,
    1,
  );
  await createCatalogService(store, remote, [dexpress]).getSeriesCatalog(spec);
  assert.equal(calls.length, 3);
  fail = true;
  const stale = await service.getSeriesCatalog({ ...spec, refresh: true });
  assert.equal(stale.stale, true);
  assert.equal(stale.checkedAt, result.checkedAt);
  assert.deepEqual(stale.items, result.items);
});

test("DEXpress repeated pages and missing counters remain incomplete; explicit zero searches are complete", async (t) => {
  const { service } = setup(
    t,
    (url) =>
      new Response(
        fixture(
          url.searchParams.get("category_id") === "2"
            ? "series-manga"
            : "series-novel",
        ),
      ),
  );
  const result = await service.getSeriesCatalog(spec);
  assert.equal(result.complete, false);
  assert.match(result.error, /incomplete/);
  const empty = setup(t, () => new Response(fixture("empty"))).service;
  const zero = await empty.getSeriesCatalog(spec);
  assert.equal(zero.complete, true);
  assert.equal(zero.needsSelection, true);
  const changed = setup(t, () => new Response("<h1>Changed page</h1>")).service;
  assert.equal((await changed.getSeriesCatalog(spec)).stale, true);
});

test("DEXpress release checks fill unlabeled formats from product data, deduplicate pages and preserve stale results", async (t) => {
  let fail = false;
  const { service, calls } = setup(
    t,
    (url) =>
      new Response(
        fail
          ? "Offline"
          : fixture(
              url.pathname.startsWith("/product/") ? "new-product" : "new",
            ),
        { status: fail ? 503 : 200 },
      ),
  );
  const result = await service.getPublisherReleases({
    publisherId: "dexpress",
  });
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].type, "LN (TH)");
  assert.equal(result.items[0].price, 370);
  assert.equal(result.items[1].type, "Manga (TH)");
  assert.equal(calls.filter(({ url }) => url.includes("/product/")).length, 1);
  fail = true;
  const stale = await service.getPublisherReleases({
    publisherId: "dexpress",
    refresh: true,
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.checkedAt, result.checkedAt);
  assert.deepEqual(stale.items, result.items);
});

test("DEXpress ISBN lookup verifies barcodes, shares canonical searches and bypasses cached misses from before DEXpress support", async (t) => {
  const fallback = {
    id: "fallback",
    hosts: [],
    isbnPriority: 100,
    create: () => ({
      lookupIsbn: async () => ({
        title: "Generic fallback",
        source: "Fallback",
      }),
    }),
  };
  const { service, store, calls, remote } = setup(
    t,
    (url, options) => {
      assert.equal(options.cache, "no-store");
      return new Response(
        fixture(url.pathname === "/search" ? "search" : "product"),
      );
    },
    [dexpress, fallback],
  );
  store.cache.put("isbn:v9:" + isbn, JSON.stringify({ found: false }), 86400);
  store.cache.put("cover:miss:v6:" + isbn, "1", 86400);
  const result = await service.lookupIsbn(isbn);
  assert.equal(result.found, true);
  assert.equal(result.details.source, "DEXpress");
  assert.equal(result.details.url, productUrl);
  assert.deepEqual(result.warnings, []);
  const exact = await service.searchPublisherIsbn({
    publisherId: "dexpress",
    isbn: "ISBN 978-616-363-462-7",
  });
  assert.equal(exact.items[0].isbn, isbn);
  await createCatalogService(store, remote, [
    dexpress,
    fallback,
  ]).searchPublisherIsbn({ publisherId: "dexpress", isbn });
  assert.equal(calls.length, 2);
});

test("DEXpress mismatches never verify an ISBN; outages, missing barcodes and changed markup allow fallback with a warning", async (t) => {
  const fallback = {
    id: "fallback",
    hosts: [],
    isbnPriority: 100,
    create: () => ({ lookupIsbn: async () => ({ title: "Fallback" }) }),
  };
  for (const [page, status, warning] of [
    [fixture("product").replace(isbn, "9780140328721"), 200, false],
    [fixture("product").replace(isbn, "SKU-00240"), 200, true],
    ["<h1>Changed markup</h1>", 200, true],
    ["Offline", 503, true],
  ]) {
    const { service } = setup(
      t,
      (url) =>
        new Response(url.pathname === "/search" ? fixture("search") : page, {
          status: url.pathname === "/search" ? 200 : status,
        }),
      [dexpress, fallback],
    );
    const result = await service.lookupIsbn(isbn);
    assert.equal(result.details.title, "Fallback");
    assert.equal(result.warnings.length, Number(warning));
  }
  const { service, calls } = setup(t, () => new Response(fixture("empty")));
  assert.equal(
    (await service.searchPublisherIsbn({ publisherId: "dexpress", isbn })).items
      .length,
    0,
  );
  await service.searchPublisherIsbn({ publisherId: "dexpress", isbn });
  assert.equal(calls.length, 1);
});

test("one unavailable DEXpress candidate cannot hide a later verified book", async (t) => {
  const { service } = setup(t, (url) => {
    if (url.pathname === "/search")
      return new Response(
        fixture("search").replaceAll("/product/240", "/product/239") +
          fixture("search"),
      );
    return url.pathname === "/product/239"
      ? new Response("Unavailable", { status: 503 })
      : new Response(fixture("product"));
  });
  const result = await service.searchPublisherIsbn({
    publisherId: "dexpress",
    isbn,
  });
  assert.equal(result.items[0].isbn, isbn);
  assert.deepEqual(result.warnings, []);
});

test("DEXpress ISBN failures retain the retry cooldown across refreshes and service restarts", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  let fail = true;
  const { service, store, remote, calls } = setup(t, (url) =>
    url.pathname === "/search"
      ? new Response(fixture("search"))
      : new Response(fail ? "Offline" : fixture("product"), {
          status: fail ? 503 : 200,
        }),
  );
  await assert.rejects(
    service.searchPublisherIsbn({ publisherId: "dexpress", isbn }),
    /unavailable/,
  );
  fail = false;
  const restarted = createCatalogService(store, remote, [dexpress]);
  await assert.rejects(
    restarted.searchPublisherIsbn({
      publisherId: "dexpress",
      isbn,
      refresh: true,
    }),
  );
  assert.equal(calls.length, 2);
  t.mock.timers.tick(15 * 60 * 1000 + 1);
  const recovered = await restarted.searchPublisherIsbn({
    publisherId: "dexpress",
    isbn,
    refresh: true,
  });
  assert.equal(recovered.items[0].isbn, isbn);
  assert.equal(calls.length, 4);
});
