import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCatalog,
  publisherKey,
  publisherCatalogSource,
  safeProductUrl,
  safeSeriesCatalogUrl,
  safePublisherUrl,
  safeCoverUrl,
  releaseItem,
  cleanRelease,
} from "../../lib/domain.ts";
import { lilyHousePage, lilyHouseProduct } from "../../lib/domain/lilyhouse.ts";
import { publisherCovers } from "../../lib/server/publisher-covers.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { lilyhouse } from "../../lib/server/scrapers/lilyhouse.ts";
import { openStore } from "../../lib/server/store.ts";
import { createScraperContext } from "../../lib/server/scrapers/http.ts";
import {
  discoverTitles,
  matchRelease,
  publisherKey as clientPublisherKey,
} from "../../lib/client/matching.ts";

const fixture = (name) =>
  readFileSync(
    new URL(
      "../fixtures/publishers/lilyhouse-" + name + ".html",
      import.meta.url,
    ),
    "utf8",
  );
const base = "https://lily-house.com";
const series = "ธาราคั่งแค้น ฉันท์แสนหมื่นชัง";
const spec = { publisherId: "lilyhouse", series, type: "LN (TH)" };
const product = base + "/shop-2/novel/pre-order-novel/tara4/";
const image =
  base + "/wp-content/uploads/2026/09/Screenshot-2569-09-29-at-14.31.33.png";
const isbn = "9786163377302";
const book = {
  series,
  publisher: "Lilly House",
  type: "LN (TH)",
  volume: 1,
  isbn: "",
  status: "Read",
  price: "",
  source: "",
  date: "",
  note: "",
};

function setup(t, respond) {
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
    service: createCatalogService(store, remote, [lilyhouse]),
  };
}

test("Lily House aliases and URL allowlists support real WooCommerce links", () => {
  for (const name of [
    "Lily House",
    "lily house.",
    "Lilly house",
    "ลิลลี่เฮ้าส์",
  ]) {
    assert.equal(publisherKey(name), "lilyhouse");
    assert.equal(clientPublisherKey(name), "lilyhouse");
  }
  assert.equal(safeProductUrl(product.slice(0, -1), "lilyhouse"), product);
  assert.equal(publisherCatalogSource(base).url, base + "/shop-2/");
  assert.equal(
    publisherCatalogSource(base + "/product-category/manga/").publisherId,
    "lilyhouse",
  );
  assert.equal(
    safeSeriesCatalogUrl(base + "/?post_type=product&s=ธารา", "lilyhouse"),
    base + "/?s=" + encodeURIComponent("ธารา") + "&post_type=product",
  );
  for (const url of [
    product + "?add-to-cart=1",
    product + "#book",
    product.replace("https:", "http:"),
    product.replace("lily-house.com", "lily-house.com.evil.test"),
    product.replace("lily-house.com", "user@lily-house.com"),
    product.replace("lily-house.com", "lily-house.com:444"),
    base + "/shop-2/page/2/",
    base + "/shop-2/novel/a%2fb/",
  ])
    assert.equal(safeProductUrl(url, "lilyhouse"), "", url);
  for (const url of [
    base + "/?s=x&s=y&post_type=product",
    base + "/?s=x&post_type=product&add-to-cart=1",
    base + "/wp-admin/",
    base + "/product-category/manga/?paged=2",
  ])
    assert.equal(safeSeriesCatalogUrl(url, "lilyhouse"), "", url);
  assert.equal(safePublisherUrl("https://evil.test/book", "Lilly House"), "");
  assert.equal(safeCoverUrl(base + "/wp-admin/cover.jpg"), "");
  assert.equal(safeCoverUrl(image), image);
});

test("live Lily House cards separate formats and languages and never use shop SKUs as ISBNs", () => {
  const items = parseCatalog("lilyhouse", fixture("releases"));
  assert.equal(items.length, 24);
  assert.ok(items.some((item) => item.type === "Manga (TH)"));
  assert.ok(items.some((item) => item.type === "LN (EN)"));
  assert.ok(items.some((item) => item.type === "LN (TH)"));
  assert.ok(
    items.every(
      (item) =>
        !item.isbn && item.coverUrl.startsWith(base + "/wp-content/uploads/"),
    ),
  );
  assert.ok(
    items.every(
      (item) =>
        !/pre\.png|comic-3\.png|แบนนเนอร์/.test(
          decodeURIComponent(item.coverUrl),
        ),
    ),
  );
  const volumes = parseCatalog("lilyhouse", fixture("search"));
  assert.deepEqual(
    volumes.slice(0, 4).map((item) => item.volume),
    [4, 3, 2, 1],
  );
  assert.ok(volumes.slice(0, 4).every((item) => item.series === series));
  assert.equal(volumes[0].price, 469);
  assert.equal(volumes[0].availability, "Pre-order");
  assert.equal(volumes[2].availability, "In stock");
  assert.ok(volumes.some((item) => item.availability === "Out of stock"));
  const english = items.find((item) => /BESIDE THE DRAGON/.test(item.title));
  assert.equal(english.series, "BESIDE THE DRAGON");
  assert.equal(english.volume, "", "Unstated one-shot volumes stay unknown");
  const bundle = items.find((item) => /ชุด3เล่มจบ/.test(item.title));
  assert.equal(bundle.bundle, true);
  assert.equal(
    matchRelease(bundle, [{ ...book, series: bundle.series, volume: 3 }]).owned
      .length,
    0,
  );
  assert.equal(
    items.find((item) => /Sprayed Edges/.test(item.title)).special,
    true,
  );
});

test("Lily House merchandise, sale prices and variable parents retain safe semantics across saving and cache reuse", async (t) => {
  const html = fixture("search");
  const merchandise = html.replaceAll(
    "product_cat-novel ",
    "product_cat-merch ",
  );
  assert.equal(parseCatalog("lilyhouse", merchandise).length, 0);
  assert.equal(lilyHousePage(merchandise).count, 11);
  const sale = html.replace(
    '<bdi><span class="woocommerce-Price-currencySymbol" translate="no" dir="auto">&#3647;</span>469</bdi>',
    "<del><bdi>฿500</bdi></del><ins><bdi>฿399</bdi></ins>",
  );
  assert.equal(parseCatalog("lilyhouse", sale)[0].price, 399);
  const variable = html.replaceAll(
    "product-type-simple",
    "product-type-variable",
  );
  const item = parseCatalog("lilyhouse", variable)[0];
  assert.equal(item.volume, "");
  assert.equal(item.price, "");
  assert.equal(item.special, true);
  assert.equal(cleanRelease(item).variantGroup, true);
  const { service, store } = setup(t, () => new Response(variable));
  const first = await service.getSeriesCatalog(spec);
  const cached = await service.getSeriesCatalog(spec);
  assert.ok(first.items.every((item) => item.special && item.volume === ""));
  assert.deepEqual(cached.items, first.items);
  assert.equal(
    store.api.setSavedRelease({ release: item, saved: true }).savedReleases[0]
      .volume,
    "",
  );
});

test("Lily House catalogs traverse WooCommerce path pagination and reject repeated, missing and malformed pages", async (t) => {
  const first = fixture("manga").replaceAll("?orderby=date", "");
  const last = fixture("search");
  const { service, calls } = setup(
    t,
    (url) => new Response(url.pathname.includes("/page/2/") ? last : first),
  );
  const result = await service.getPublisherCatalog({
    url: base + "/product-category/manga/",
  });
  assert.equal(result.complete, true);
  assert.equal(result.pages, 2);
  assert.equal(result.total, 15);
  assert.equal(result.items.length, 15);
  assert.equal(calls[1].url, base + "/product-category/manga/page/2/");
  for (const response of [
    () => new Response(first),
    (url) =>
      new Response(
        url.pathname.includes("/page/2/") ? "<h1>Changed markup</h1>" : first,
      ),
    (url) =>
      new Response(url.pathname.includes("/page/2/") ? "Unavailable" : first, {
        status: url.pathname.includes("/page/2/") ? 503 : 200,
      }),
  ]) {
    const partial = setup(t, response);
    const catalog = await partial.service.getPublisherCatalog({
      url: base + "/product-category/manga/",
    });
    assert.equal(catalog.complete, false);
    assert.equal(catalog.items.length, 4);
  }
  const malformed = setup(
    t,
    () =>
      new Response(
        last.replaceAll("/shop-2/novel/pre-order-novel/tara4/", "/wp-admin/"),
      ),
  );
  assert.equal(
    (await malformed.service.getPublisherCatalog({ url: base + "/shop-2/" }))
      .stale,
    true,
  );
});

test("Lily House series searches annotate unrelated stories and retain complete results through incomplete refreshes and restarts", async (t) => {
  let mode = "complete";
  const { store, remote, service, calls } = setup(
    t,
    () =>
      new Response(
        mode === "offline"
          ? "Unavailable"
          : mode === "partial"
            ? fixture("manga")
            : fixture("search"),
        { status: mode === "offline" ? 503 : 200 },
      ),
  );
  const fresh = await service.getSeriesCatalog(spec);
  assert.equal(fresh.complete, true);
  assert.equal(fresh.search, true);
  assert.ok(
    fresh.items
      .slice(0, 4)
      .every((item) => !item.catalogVariant && item.catalogSeries === series),
  );
  assert.ok(fresh.items.slice(4).every((item) => item.catalogVariant));
  assert.equal(new URL(calls[0].url).searchParams.get("s"), series);
  assert.equal(new URL(calls[0].url).searchParams.get("post_type"), "product");
  mode = "partial";
  const partial = await service.getSeriesCatalog({ ...spec, refresh: true });
  assert.equal(partial.stale, true);
  assert.equal(partial.checkedAt, fresh.checkedAt);
  assert.deepEqual(partial.items, fresh.items);
  mode = "offline";
  const stale = await createCatalogService(store, remote, [
    lilyhouse,
  ]).getSeriesCatalog({ ...spec, refresh: true });
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.items, fresh.items);
});

test("Lily House release windows sort by date, deduplicate, persist and survive outages", async (t) => {
  let offline = false;
  const { service, store, remote, calls } = setup(
    t,
    () =>
      new Response(offline ? "Unavailable" : fixture("releases"), {
        status: offline ? 503 : 200,
      }),
  );
  const fresh = await service.getPublisherReleases({
    publisherId: "lilyhouse",
  });
  assert.equal(fresh.stale, false);
  assert.equal(fresh.items.length, 24);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, base + "/shop-2/page/2/?orderby=date");
  await service.getPublisherReleases({ publisherId: "lilyhouse" });
  assert.equal(calls.length, 2);
  offline = true;
  const stale = await createCatalogService(store, remote, [
    lilyhouse,
  ]).getPublisherReleases({ publisherId: "lilyhouse", refresh: true });
  assert.equal(stale.stale, true);
  assert.equal(stale.checkedAt, fresh.checkedAt);
  assert.deepEqual(stale.items, fresh.items);
});

test("Lily House ISBN searches cache canonical ISBNs, mark candidates unverified and distinguish empty searches from failures", async (t) => {
  const { service, calls, store } = setup(
    t,
    () => new Response(fixture("search")),
  );
  const [first, equivalent] = await Promise.all([
    service.searchPublisherIsbn({ publisherId: "lilyhouse", isbn }),
    service.searchPublisherIsbn({
      publisherId: "lilyhouse",
      isbn: "ISBN 978616337-730-2",
    }),
  ]);
  assert.deepEqual(first, equivalent);
  assert.equal(calls.length, 1);
  assert.equal(first.items.length, 11);
  assert.ok(first.items.every((item) => item.isbn === ""));
  assert.match(first.warnings[0], /unverified/);
  await createCatalogService(
    store,
    () => assert.fail("ISBN cache must survive restarts"),
    [lilyhouse],
  ).searchPublisherIsbn({ publisherId: "lilyhouse", isbn });
  assert.equal(
    (await service.lookupIsbn(isbn)).found,
    false,
    "Unverified candidates cannot become automatic metadata",
  );
  const empty = setup(t, () => new Response(fixture("empty")));
  assert.equal(
    (
      await empty.service.searchPublisherIsbn({
        publisherId: "lilyhouse",
        isbn,
      })
    ).items.length,
    0,
  );
  await empty.service.searchPublisherIsbn({ publisherId: "lilyhouse", isbn });
  assert.equal(empty.calls.length, 1);
  const broken = setup(t, () => new Response("<h1>Changed markup</h1>"));
  await assert.rejects(
    broken.service.searchPublisherIsbn({ publisherId: "lilyhouse", isbn }),
    /could not be read/,
  );
});

test("Lily House main product covers exclude badges and unrelated schemas", async () => {
  const html = fixture("product");
  const detail = lilyHouseProduct(html, product);
  assert.equal(detail.isbn, "");
  assert.equal(detail.type, "LN (TH)");
  assert.equal(detail.price, "469");
  assert.deepEqual(detail.covers, [image]);
  const decoy =
    '<script type="application/ld+json">{"@type":"Product","url":"https://lily-house.com/shop-2/novel/other/","sku":"other","image":"https://lily-house.com/wp-content/uploads/unrelated.png"}</script>';
  assert.deepEqual(publisherCovers(html + decoy, product), [image]);
  assert.deepEqual(
    publisherCovers(
      html.replace('class="product-information"', 'class="missing"') +
        '<img data-large_image="https://lily-house.com/wp-content/uploads/unrelated.png">' +
        decoy,
      product,
    ),
    [image],
    "An unbounded gallery cannot include later recommendation images",
  );
  assert.throws(
    () => lilyHouseProduct(html.replaceAll("/tara4/", "/other/"), product),
    /could not be read/,
  );
});

test("Lily House redirects can normalize a slash but cannot change the host, resource or query", async (t) => {
  const { store } = setup(t, () => assert.fail("Unexpected request"));
  const safe = createScraperContext(
    store.cache,
    async (url) =>
      url.endsWith("/")
        ? new Response(fixture("product"))
        : new Response(null, { status: 301, headers: { location: product } }),
    [lilyhouse],
  );
  assert.equal((await safe.requestRemote(product.slice(0, -1))).status, 200);
  for (const location of [
    "https://evil.test/shop-2/novel/book/",
    product.replace("tara4", "tara3"),
    product + "?add-to-cart=1",
    product.replace("lily-house.com", "lily-house.com:444"),
  ]) {
    const unsafe = createScraperContext(
      store.cache,
      async () => new Response(null, { status: 302, headers: { location } }),
      [lilyhouse],
    );
    await assert.rejects(unsafe.requestRemote(product), /redirect/);
  }
});

test("Lily House stops at twenty pages without claiming full coverage", async (t) => {
  const url = base + "/product-category/novel/";
  const { service, calls } = setup(t, (endpoint) => {
    const page = Number(/\/page\/(\d+)\//.exec(endpoint.pathname)?.[1] || 1);
    const next = url + "page/" + (page + 1) + "/";
    return new Response(
      fixture("search").replaceAll(
        "/shop-2/",
        "/shop-2/snapshot-" + page + "/",
      ) +
        '<nav class="woocommerce-pagination"><span class="page-numbers current">' +
        page +
        '</span><a class="next page-numbers" href="' +
        next +
        '">Next</a></nav>',
    );
  });
  const result = await service.getPublisherCatalog({ url });
  assert.equal(result.pages, 20);
  assert.equal(result.complete, false);
  assert.equal(result.total, null);
  assert.equal(calls.length, 20);
});

test("Lily House books without ISBNs get series covers and keep language and format ownership separate", async (t) => {
  const { service, store, calls } = setup(
    t,
    () => new Response(fixture("search")),
  );
  store.api.saveBook({ requestId: "lilyhouse_cover_test", book });
  const owned = store.api.getCollection().books[0];
  const cover = await service.getBookCover({ row: owned.row });
  assert.match(
    cover.coverUrl,
    /^https:\/\/lily-house\.com\/wp-content\/uploads\//,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(await service.getBookCover({ row: owned.row }), cover);
  const manga = releaseItem(
    "lilyhouse",
    "Story เล่ม 1",
    product,
    200,
    "",
    "Manga (TH)",
  );
  const novel = { ...manga, type: "LN (TH)", id: "novel" };
  const english = { ...manga, type: "Manga (EN)", id: "english" };
  const discovered = discoverTitles(
    [manga, novel, english],
    [{ ...book, series: "Story", type: "Manga (TH)" }],
  );
  assert.deepEqual(discovered.map((item) => item.type).sort(), [
    "LN (TH)",
    "Manga (EN)",
  ]);
});
