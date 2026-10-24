import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { publisherCovers } from "../../lib/server/publisher-covers.ts";
import { publisherKey as clientPublisherKey } from "../../lib/client/matching.ts";
import {
  parseCatalog,
  parsePublisherTitles,
  parseSeriesCategories,
  catalogTotal,
  publisherKey,
  safeProductUrl,
  safeSeriesCatalogUrl,
  safePublisherUrl,
  publisherCatalogSource,
  releaseItem,
  splitAnimagTitle,
  animagVariants,
} from "../../lib/domain.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/animag-" + name + ".html", import.meta.url),
    "utf8",
  );
const base = "https://www.animagshop.com";
const isbn = "9786163377302";
const series = "Re:ZERO รีเซทชีวิต ฝ่าวิกฤตต่างโลก";
const spec = { publisherId: "animag", series, type: "LN (TH)" };
const mainCover = "https://fs.lnwfile.com/_/fs/_raw/ff/pm/yc.jpg";
const book = {
  series,
  publisher: "A-Plus",
  type: "LN (TH)",
  status: "Read",
  volume: 20,
  isbn: "",
  price: "",
  date: "",
  source: "",
  note: "",
};

function setup(t, respond) {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const calls = [];
  const remote = async (url, options) => {
    calls.push({ url, options });
    return respond(url, options);
  };
  return { store, calls, remote, service: createCatalogService(store, remote) };
}

test("Animag imprints share publisher identity in the client and server; catalog and product URLs stay on the allowed host", () => {
  for (const name of [
    "Animag",
    "อนิแม็ก",
    "A-Plus",
    "G-Plus",
    "ANIMAG BOOKS",
    "AG-COMICS",
    "BeLOVED+",
  ]) {
    assert.equal(publisherKey(name), "animag");
    assert.equal(clientPublisherKey(name), "animag");
  }
  assert.equal(
    safeProductUrl(base + "/product/1169/ชื่อหนังสือ", "animag"),
    base + "/product/1169",
  );
  assert.equal(
    safeSeriesCatalogUrl(base + "/category/13/series/name", "animag"),
    base + "/category/13",
  );
  assert.equal(publisherCatalogSource(base + "/").publisherId, "animag");
  for (const url of [
    "http://www.animagshop.com/product/1",
    "https://www.animagshop.com.evil.test/product/1",
    "https://user@www.animagshop.com/product/1",
    base + ":8080/product/1",
    base + "/product/1?q=x",
    base + "/product/1#x",
  ]) {
    assert.equal(safeProductUrl(url, "animag"), "");
  }
  assert.equal(safePublisherUrl("https://evil.test/book", "A-Plus"), "");
  assert.equal(
    safeSeriesCatalogUrl(base + "/category/13?tskp=2", "animag"),
    "",
  );
});

test("live Animag listings retain sale prices, checked ISBNs, original covers, preorder labels and edition distinctions", () => {
  const items = parseCatalog("animag", fixture("catalog"));
  assert.equal(items.length, 6);
  assert.equal(items[0].price, 120);
  assert.equal(items[0].isbn, "9786166103076");
  assert.equal(items[0].type, "Manga (TH)");
  assert.equal(items[0].volume, 1);
  assert.equal(items[0].availability, "Pre-order");
  assert.match(items[0].coverUrl, /\/_raw\//);
  assert.ok(!items[0].series.includes("Animag"));
  assert.ok(!items[0].series.includes("COMIC"));
  assert.ok(items[1].special && !items[1].isbn);
  assert.equal(items[2].volume, 1, "เล่มเดียวจบ is one volume");
  const normal = parseCatalog("animag", fixture("search"))[0];
  assert.equal(normal.isbn, isbn);
  assert.equal(normal.price, 320);
  assert.equal(normal.availability, "In stock");
  assert.equal(normal.type, "LN (TH)");
  assert.equal(
    splitAnimagTitle("Animag เรื่องหนึ่ง NOVEL เล่ม 14.5").volume,
    14.5,
  );
  assert.equal(
    splitAnimagTitle("Animag 29&JK แผนลับ NOVEL เล่ม 6").series,
    "29&JK แผนลับ",
  );
  assert.ok(
    releaseItem(
      "animag",
      "Animag เรื่องหนึ่ง NOVEL BOXSET (เล่ม 1-7)",
      base + "/product/1",
      100,
      isbn,
    ).bundle,
  );
  assert.equal(
    parseCatalog(
      "animag",
      fixture("search").replace('realprice="320"', 'realprice="0"'),
    )[0].price,
    0,
  );
});

test("Animag directories discover all five book imprints and preserve category formats and scoped browsing", () => {
  const html = fixture("directory");
  const categories = parseSeriesCategories("animag", html);
  assert.equal(categories.length, 212);
  assert.ok(
    categories.some(
      (category) =>
        category.url === base + "/category/13" &&
        category.title === series &&
        category.type === "LN (TH)",
    ),
  );
  const scopes = [1, 3, 2, 4, 190].map((id) =>
    parsePublisherTitles("animag", html, base + "/category/" + id),
  );
  assert.equal(scopes.flat().length, categories.length);
  assert.ok(scopes.every((titles) => titles.length));
  assert.ok(scopes[0].every((title) => title.type === "LN (TH)"));
  assert.ok(scopes[4].every((title) => title.type === "Manga (TH)"));
  assert.equal(
    parsePublisherTitles("animag", html, base + "/category/13").length,
    1,
  );
  assert.equal(
    catalogTotal(
      "animag",
      '<span class="tsk-all">500</span>' + fixture("series"),
    ),
    39,
  );
  assert.equal(catalogTotal("animag", fixture("empty")), 0);
  assert.equal(
    catalogTotal("animag", '<span class="tsk-all">500</span>'),
    null,
  );
});

test("Animag full series catalogs paginate independently of release feeds and saved aliases remain edition-specific", async (t) => {
  const html = fixture("series");
  const cards = html.split(/(?=<div class="productArea productItem">)/);
  const header = cards.shift();
  const count =
    'แสดงสินค้าที่ 1-39 จากทั้งหมด <span class="tsk-all">39</span> ชิ้น';
  const first = header + cards.slice(0, 20).join("") + count;
  const second = header + cards.slice(20).join("");
  const { store, service, calls } = setup(
    t,
    (url) =>
      new Response(
        url === base + "/search"
          ? fixture("directory")
          : url.endsWith("?tskp=2")
            ? second
            : first,
      ),
  );
  const catalog = await service.getSeriesCatalog(spec);
  assert.equal(catalog.complete, true);
  assert.equal(catalog.total, 39);
  assert.equal(catalog.pages, 2);
  assert.equal(catalog.items.length, 39);
  assert.ok(calls.some(({ url }) => url === base + "/category/13?tskp=2"));
  assert.ok(calls.every(({ url }) => !url.includes("sortby=new")));
  assert.ok(
    catalog.items.some(
      (item) => item.volume === 20 && !item.catalogVariant && !item.bundle,
    ),
  );
  const local = { ...spec, series: "My translated series" };
  store.api.setSeriesCatalog({
    ...local,
    url: base + "/category/13/ชื่อ",
    title: series,
  });
  const linked = await createCatalogService(store, () =>
    assert.fail("Cached pages should be shared"),
  ).getSeriesCatalog(local);
  assert.equal(linked.complete, true);
  assert.ok(linked.items.every((item) => item.catalogSeries === local.series));
  assert.equal(
    store.savedSeriesCatalog({ ...local, type: "Manga (TH)" }),
    null,
  );
  assert.equal(
    (
      await service.getSeriesCatalog({
        ...spec,
        series: "Unrecognized translation",
      })
    ).needsSelection,
    true,
  );
});

test("Animag repeated pages, missing totals and refresh outages cannot claim full catalog coverage", async (t) => {
  let mode = "complete";
  const html = fixture("series");
  const { store, service, remote } = setup(
    t,
    (url) =>
      new Response(
        mode === "offline"
          ? "Unavailable"
          : url === base + "/search"
            ? fixture("directory")
            : mode === "repeat"
              ? html.replace(">39</span>", ">40</span>")
              : mode === "no-count"
                ? html.replace(/แสดงสินค้าที่[^\n]+/, "")
                : html,
        { status: mode === "offline" ? 503 : 200 },
      ),
  );
  const fresh = await service.getSeriesCatalog(spec);
  assert.equal(fresh.complete, true);
  mode = "repeat";
  const stale = await service.getSeriesCatalog({ ...spec, refresh: true });
  assert.equal(stale.stale, true);
  assert.equal(stale.checkedAt, fresh.checkedAt);
  assert.equal(stale.items.length, fresh.items.length);
  const unknown = await service.getPublisherCatalog({
    url: base + "/category/999",
  });
  assert.equal(unknown.complete, false);
  assert.equal(unknown.pages, 2);
  mode = "no-count";
  assert.equal(
    (await service.getPublisherCatalog({ url: base + "/category/998" }))
      .complete,
    false,
  );
  mode = "offline";
  const restarted = createCatalogService(store, remote);
  assert.equal(
    (await restarted.getSeriesCatalog({ ...spec, refresh: true })).stale,
    true,
  );
});

test("Animag ISBN search confirms the main product, coalesces canonical ISBNs and shares detail pages and galleries", async (t) => {
  const { store, service, calls } = setup(
    t,
    (url) =>
      new Response(
        url.includes("/search?") ? fixture("search") : fixture("product"),
      ),
  );
  const [result, equivalent] = await Promise.all([
    service.searchPublisherIsbn({ publisherId: "animag", isbn }),
    service.searchPublisherIsbn({
      publisherId: "animag",
      isbn: "ISBN: 978616337-730-2",
    }),
  ]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].isbn, isbn);
  assert.equal(result.items[0].coverUrl, mainCover);
  assert.equal(result.items[0].source, "Animag");
  assert.deepEqual(result, equivalent);
  assert.equal(calls.length, 2);
  await createCatalogService(store, () =>
    assert.fail("A restart must reuse ISBN results"),
  ).searchPublisherIsbn({ publisherId: "animag", isbn });
  const decoy =
    '<script type="application/ld+json">{"@type":"Product","url":"' +
    base +
    '/product/999","sku":"' +
    isbn +
    '","image":["https://fs.lnwfile.com/unrelated.jpg"]}</script><img class="productImage" src="https://fs.lnwfile.com/also-unrelated.jpg">';
  const covers = publisherCovers(
    fixture("product") + decoy,
    base + "/product/1169",
  );
  assert.equal(covers[0], mainCover);
  assert.equal(covers.length, 2);
});

test("Animag ISBN verification rejects mismatches, recommendation ISBNs, incomplete markup and cross-host redirects", async (t) => {
  for (const product of [
    fixture("product").replace(
      '"sku": "978616337-730-2"',
      '"sku": "9780140328721"',
    ),
    fixture("product").replace("/product/1169/", "/product/999/"),
  ]) {
    const { service } = setup(
      t,
      (url) =>
        new Response(url.includes("/search?") ? fixture("search") : product),
    );
    if (product.includes("/product/999/"))
      await assert.rejects(
        service.searchPublisherIsbn({ publisherId: "animag", isbn }),
        /ISBN details/,
      );
    else
      assert.equal(
        (await service.searchPublisherIsbn({ publisherId: "animag", isbn }))
          .items.length,
        0,
      );
  }
  for (const location of [
    "https://evil.test/product/1169",
    base + "/product/999",
    base + ":8443/product/1169",
  ]) {
    const { service } = setup(t, (url) =>
      url.includes("/search?")
        ? new Response(fixture("search"))
        : new Response(null, { status: 302, headers: { location } }),
    );
    await assert.rejects(
      service.searchPublisherIsbn({ publisherId: "animag", isbn }),
      /redirect/,
    );
  }
  const { service } = setup(
    t,
    (url) =>
      new Response(
        url.includes("/search?")
          ? fixture("search")
          : "<h1>Missing product schema</h1>",
      ),
  );
  await assert.rejects(
    service.searchPublisherIsbn({ publisherId: "animag", isbn }),
    /ISBN details/,
  );
});

test("Animag confirmed ISBN misses are cached, malformed search pages fail and allowed slug redirects retain identity", async (t) => {
  const { store, service, calls } = setup(
    t,
    () => new Response(fixture("empty")),
  );
  assert.equal(
    (await service.searchPublisherIsbn({ publisherId: "animag", isbn })).items
      .length,
    0,
  );
  await createCatalogService(store, () =>
    assert.fail("Confirmed misses are cached"),
  ).searchPublisherIsbn({ publisherId: "animag", isbn });
  assert.equal(calls.length, 1);
  const broken = setup(t, () => new Response("<h1>Changed search</h1>"));
  await assert.rejects(
    broken.service.searchPublisherIsbn({ publisherId: "animag", isbn }),
    /could not be read/,
  );
  const redirected = setup(t, (url) =>
    url.includes("/search?")
      ? new Response(fixture("search"))
      : url.endsWith("/1169")
        ? new Response(null, {
            status: 302,
            headers: {
              location:
                base +
                "/product/1169/" +
                Buffer.from("ชื่อหนังสือ").toString("latin1"),
            },
          })
        : new Response(fixture("product")),
  );
  assert.equal(
    (
      await redirected.service.searchPublisherIsbn({
        publisherId: "animag",
        isbn,
      })
    ).items[0].url,
    base + "/product/1169",
  );
});

test("Animag releases paginate with new-arrival sorting, cache listings and preserve them through outages", async (t) => {
  let offline = false;
  const { store, remote, service, calls } = setup(
    t,
    () =>
      new Response(offline ? "Unavailable" : fixture("catalog"), {
        status: offline ? 503 : 200,
      }),
  );
  const fresh = await service.getPublisherReleases({ publisherId: "animag" });
  assert.equal(fresh.stale, false);
  assert.equal(fresh.items.length, 6);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, base + "/category?sortby=new&tskp=2");
  await service.getPublisherReleases({ publisherId: "animag" });
  assert.equal(calls.length, 2);
  offline = true;
  const stale = await createCatalogService(store, remote).getPublisherReleases({
    publisherId: "animag",
    refresh: true,
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.checkedAt, fresh.checkedAt);
  assert.deepEqual(stale.items, fresh.items);
});

test("Animag books without ISBNs obtain covers through their full series catalog, including imprint aliases", async (t) => {
  const { store, service, calls } = setup(
    t,
    (url) =>
      new Response(
        url === base + "/search" ? fixture("directory") : fixture("series"),
      ),
  );
  store.api.saveBook({ requestId: "animag_cover_volume_20", book });
  const owned = store.api.getCollection().books[0];
  const cover = await service.getBookCover({ row: owned.row });
  assert.match(cover.coverUrl, /^https:\/\/fs\.lnwfile\.com\//);
  assert.equal(calls.length, 2);
  assert.equal(
    (await service.getBookCover({ row: owned.row })).coverUrl,
    cover.coverUrl,
  );
  assert.equal(calls.length, 2);
});

test("Animag selectable products expand to distinct volume URLs and images without assigning the parent ISBN or cover", async (t) => {
  const parent = base + "/product/1304";
  const live = animagVariants(fixture("variants"), parent);
  assert.equal(live.length, 1);
  assert.equal(live[0].url, parent + "?pid=1307");
  assert.equal(live[0].bundle, true);
  assert.equal(live[0].isbn, "");
  const name = "ยัยเสือใสกับนายหน้าโหด ~โทระโดระ!~";
  const variants =
    '<script type="application/ld+json">' +
    JSON.stringify([
      {
        "@type": "Product",
        name: "Animag " + name + " NOVEL",
        url: parent,
        sku: "AGS-TO00",
        image: ["https://fs.lnwfile.com/parent.jpg"],
      },
      ...[7, 8].map((volume, index) => ({
        "@type": "Product",
        name: "Animag " + name + " NOVEL เล่ม " + volume,
        url: parent + "/title?pid=" + (1307 + index),
        sku: index ? "9780140328721" : isbn,
        image: ["https://fs.lnwfile.com/volume-" + volume + ".jpg"],
        offers: {
          price: 200 + index,
          availability: "https://schema.org/InStock",
        },
      })),
    ]) +
    "</script>";
  const listing =
    "<h1>" +
    name +
    '</h1><div class="productArea productItem"><a class="gadgetThumbnail" title="Animag ' +
    name +
    ' NOVEL" href="' +
    parent +
    '"></a><a>เลือกแบบสินค้า</a></div>แสดงสินค้าที่ 1-1 จากทั้งหมด <span class="tsk-all">1</span> ชิ้น';
  const { store, service } = setup(
    t,
    (url) => new Response(url.includes("/product/") ? variants : listing),
  );
  const result = await service.getPublisherCatalog({
    url: base + "/category/500",
  });
  assert.equal(result.complete, true);
  assert.equal(
    result.total,
    1,
    "Completeness counts parent listings, not variant count",
  );
  assert.deepEqual(
    result.items.map((item) => item.volume),
    [7, 8],
  );
  assert.equal(new Set(result.items.map((item) => item.id)).size, 2);
  assert.equal(result.items[0].isbn, isbn);
  assert.equal(result.items[0].coverUrl, "https://fs.lnwfile.com/volume-7.jpg");
  assert.deepEqual(publisherCovers(variants, parent + "?pid=1308"), [
    "https://fs.lnwfile.com/volume-8.jpg",
  ]);
  const match = await service.searchPublisherIsbn({
    publisherId: "animag",
    isbn,
  });
  assert.equal(match.items[0].url, parent + "?pid=1307");
  const saved = store.api.setSavedRelease({
    saved: true,
    release: match.items[0],
  }).savedReleases[0];
  assert.equal(saved.url, parent + "?pid=1307");
  assert.equal(saved.volume, 7);
  assert.equal(
    safeProductUrl(parent + "?pid=1307&redirect=evil", "animag"),
    "",
  );
});

test("automatic barcode lookup includes verified Animag metadata before generic providers", async (t) => {
  const { store, service, calls } = setup(
    t,
    (url) =>
      new Response(
        url === base + "/search?q=" + isbn
          ? fixture("search")
          : url === base + "/product/1169"
            ? fixture("product")
            : "Unavailable",
        { status: url.startsWith(base) ? 200 : 503 },
      ),
  );
  store.cache.put("cover:miss:v5:" + isbn, "1", 86400);
  store.cache.put(
    "isbn:v8:" + isbn,
    JSON.stringify({ isbn, found: false, details: null, warnings: [] }),
    86400,
  );
  store.api.saveBook({
    requestId: "animag_isbn_cover_2",
    book: { ...book, series: "ซวยฉิบหายเกิดใหม่เป็นจอมมาร", isbn, volume: 2 },
  });
  const row = store.api.getCollection().books[0].row;
  assert.equal(
    (await service.getBookCover({ row })).coverUrl,
    mainCover,
    "Old confirmed misses must not hide the new provider",
  );
  const result = await service.lookupIsbn(isbn);
  assert.equal(result.found, true);
  assert.equal(result.details.source, "Animag");
  assert.equal(result.details.volume, 2);
  assert.equal(result.details.coverUrl, mainCover);
  const count = calls.length;
  assert.deepEqual(await service.lookupIsbn("978616337-730-2"), result);
  assert.equal(calls.length, count);
});
