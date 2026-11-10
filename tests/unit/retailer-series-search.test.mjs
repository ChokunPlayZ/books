import test from "node:test";
import assert from "node:assert/strict";
import { createSearchService } from "../../lib/server/search.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { luckpim } from "../../lib/server/scrapers/luckpim.ts";
import { naiin } from "../../lib/server/scrapers/naiin.ts";
import { yaakz } from "../../lib/server/scrapers/yaakz.ts";
import { yaakzItems } from "../../lib/server/yaakz.ts";
import {
  groupSearchResults,
  mergeSearchResults,
} from "../../lib/domain/search.ts";
import {
  cleanRelease,
  parseCatalog,
  publisherKey,
  volumeCoverKey,
} from "../../lib/domain.ts";

const query = "เกมสารภาพรัก";
const series = "เกมสารภาพรักนี้น่ะ เรามาจบมันกันเถอะ";
const compact = series.replaceAll(" ", "");
const volumes = [1, 2, 3, 4, 5, 6];
const definitions = [luckpim, naiin, yaakz];
const parent = {
  uuid: "1000",
  title: `[แยกเล่ม] ${series} เล่ม 01-06`,
  has_subproduct: true,
  category_name: "Luckpim / มังงะ",
  subproducts: volumes.map((volume) => ({
    uuid: String(1000 + volume),
    title: `${compact} เล่ม ${String(volume).padStart(2, "0")}`,
    price: 135,
    list_price: 150,
    images: `https://du.lnwfile.com/volume-${volume}.jpg`,
  })),
};
const publisherBooks = volumes.map((volume) => ({
  slug: String(volume),
  title: `${series} ${String(volume).padStart(2, "0")} (Mg)`,
  main_category: "มังงะ/การ์ตูน",
  price: 150,
  price_sale: 135,
  thumbnail: `volume-${volume}.jpg`,
  thumbnail_gen: "abcdefghij",
}));
const shopBooks = volumes.map((volume) => ({
  ProductTypeId: 1,
  ProductID: volume,
  ProductName: `${series} เล่ม ${volume}`,
  PublisherName: "รักพิมพ์",
  PriceFull: 150,
  PriceDiscount: 135,
  ThumbnailFile: `https://storage.naiin.com/volume-${volume}.jpg`,
}));

// Representative Nuxt records, encoded as data references rather than scripts.
function nuxtPage(product) {
  const values = [];
  function write(value) {
    const index = values.length;
    values.push(null);
    values[index] =
      value && typeof value === "object"
        ? Array.isArray(value)
          ? value.map(write)
          : Object.fromEntries(
              Object.entries(value).map(([key, child]) => [key, write(child)]),
            )
        : value;
    return index;
  }
  write({ pinia: { products: { products: { [product.uuid]: product } } } });
  return `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(values)}</script>`;
}

function memoryStore(books = []) {
  const values = new Map();
  return {
    values,
    api: {
      getCollection: async () => ({ books, savedReleases: [], trash: [] }),
    },
    savedSeriesCatalog: async () => null,
    cache: {
      get: (key) => values.get(key) ?? null,
      put: (key, value) => values.set(key, value),
      searchable: async () =>
        [...values]
          .filter(([key]) => key.startsWith("search-titles:v1:"))
          .map(([key, value]) => ({ key, value })),
    },
  };
}

async function remote(address) {
  const url = new URL(address);
  if (url.hostname === "www.luckpim.com") {
    if (url.pathname.startsWith("/get/search_pin/"))
      return Response.json({
        status: 200,
        data: { list: publisherBooks, total: 6 },
      });
    return new Response(
      '<input name="__RequestVerificationToken" value="test-token">',
    );
  }
  if (url.hostname === "www.naiin.com") {
    if (url.pathname.startsWith("/product/")) {
      const volume = Number(url.pathname.split("/").pop());
      return new Response(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "Book",
          name: shopBooks[volume - 1].ProductName,
          publisher: "รักพิมพ์",
          url: address,
          image: shopBooks[volume - 1].ThumbnailFile,
        })}</script>`,
      );
    }
    return new Response(`<product-list :items='${JSON.stringify(shopBooks)}'>`);
  }
  if (url.hostname === "www.yaakz.com")
    return url.pathname === "/api/products"
      ? Response.json({ data: [parent], total: 1 })
      : new Response(nuxtPage(parent));
  assert.fail("Unexpected URL: " + address);
}

test("เกมสารภาพรัก resolves by name into one series, six unique volumes and all three stores without ISBNs", async () => {
  const store = memoryStore();
  const service = createSearchService(store, {}, remote, definitions);
  const responses = await Promise.all(
    definitions.map((source) =>
      service.searchExternalTitles({ query, sourceId: source.id }),
    ),
  );
  for (const order of [responses, [...responses].reverse()]) {
    let results = [];
    for (const response of order)
      results = mergeSearchResults(query, results, response.results);
    assert.equal(results.length, 6);
    const groups = groupSearchResults(results);
    assert.equal(groups.length, 1);
    assert.equal(
      groups[0].title,
      series,
      "Use the publisher's spelling, independent of response order",
    );
    assert.deepEqual(
      groups[0].items.map((item) => item.volume),
      volumes,
    );
    for (const item of results) {
      assert.equal(publisherKey(item.publisher), "luckpim");
      assert.equal(item.isbn, "");
      assert.equal(item.sources.length, 3);
      assert.equal(item.msrp, 150);
      assert.equal(item.msrpCurrency, "THB");
      assert.doesNotMatch(item.coverUrl, /luckpim/);
    }
  }
  const restarted = createSearchService(
    store,
    {},
    () => assert.fail("Use cached discoveries"),
    definitions,
  );
  const known = await restarted.searchKnownEntities({ query });
  assert.equal(groupSearchResults(known.results).length, 1);
  assert.equal(known.results.length, 6);
  for (const item of known.results) {
    assert.equal(
      item.sources.length,
      3,
      "Cache reads preserve every store link",
    );
    assert.doesNotMatch(
      (await restarted.getSearchCover({ query, id: item.id })).coverUrl,
      /luckpim/,
    );
  }
});

test("Yaakz retains the actual publisher through catalog cache reads and saved releases", async () => {
  const store = memoryStore();
  const catalogs = createCatalogService(store, remote, definitions);
  const url = "https://www.yaakz.com/search?q=" + encodeURIComponent(series);
  for (let repeat = 0; repeat < 2; repeat++) {
    const catalog = await catalogs.getPublisherCatalog({ url });
    assert.equal(catalog.items.length, 6);
    for (const item of catalog.items) {
      assert.equal(item.publisherId, "yaakz", "Source remains Yaakz");
      assert.equal(
        item.publisher,
        "Luckpim",
        "Publisher is not the storefront",
      );
      assert.equal(cleanRelease(item).publisher, "Luckpim");
      assert.equal(
        volumeCoverKey(item),
        volumeCoverKey({ ...item, publisherId: "luckpim" }),
        "Cross-store cover identity uses the publisher, not the retailer",
      );
    }
  }
  await catalogs.getSeriesCatalog({
    publisherId: "luckpim",
    series,
    type: "Manga",
  });
  assert.equal(
    await store.cache.get(volumeCoverKey(yaakzItems(parent)[0])),
    parent.subproducts[0].images,
    "Refreshing Luckpim must not downgrade a retailer cover already cached for this edition",
  );
  assert.equal(
    yaakzItems({
      ...parent,
      category_name: "",
      subproducts: [parent.subproducts[0]],
    })[0].publisher,
    "",
  );
  const saleOnly = yaakzItems({
    ...parent,
    subproducts: [{ ...parent.subproducts[0], list_price: undefined }],
  })[0];
  assert.equal(saleOnly.price, 135);
  assert.equal(saleOnly.msrp, "", "A permanent discount cannot establish MSRP");
});

test("fresh retailer results repair legacy publisher labels before merging with the publisher", async () => {
  const store = memoryStore();
  const service = createSearchService(store, {}, remote, definitions);
  await service.searchExternalTitles({ query, sourceId: "yaakz" });
  for (const [key, value] of store.values) {
    if (!key.startsWith("search-titles:v1:")) continue;
    const snapshot = JSON.parse(value);
    snapshot.version = 1;
    snapshot.items = snapshot.items.map((item) => ({
      ...item,
      publisher: "Siam Inter Comics (Yaakz)",
    }));
    store.values.set(key, JSON.stringify(snapshot));
  }
  const known = await service.searchKnownEntities({ query });
  const refreshed = await service.searchExternalTitles({
    query,
    sourceId: "yaakz",
  });
  const publisher = await service.searchExternalTitles({
    query,
    sourceId: "luckpim",
  });
  for (const order of [
    [refreshed, publisher],
    [publisher, refreshed],
  ]) {
    let results = known.results;
    for (const response of order)
      results = mergeSearchResults(query, results, response.results);
    assert.equal(results.length, 6);
    assert.ok(results.every((item) => item.publisher === "Luckpim"));
    assert.ok(results.every((item) => item.sources.length === 2));
  }
});

test("ISBN-less Luckpim automatic covers use title-based retailers before publisher thumbnails", async () => {
  const store = memoryStore([
    {
      row: 1,
      token: "token",
      series,
      volume: 1,
      publisher: "Luckpim",
      type: "Manga",
      isbn: "",
    },
  ]);
  const catalogs = createCatalogService(store, remote, definitions);
  const options = await catalogs.getBookCoverOptions({ row: 1 });
  assert.ok(options.covers.length >= 2);
  assert.doesNotMatch(options.covers[0].coverUrl, /luckpim/);
  assert.match(options.covers.at(-1).coverUrl, /luckpim/);
  const automatic = await catalogs.getBookCover({ row: 1 });
  assert.doesNotMatch(automatic.coverUrl, /luckpim/);
  assert.ok(automatic.coverUrl);
});

test("catalog list prices come from oldPrice/regular-price fields, never sale amounts or analytics prices", () => {
  const firstpage = parseCatalog(
    "firstpage",
    `<div class="productArea productItem"><a class="gadgetThumbnail" href="https://www.firstpagepro.com/product/1/story" title="(มังงะ) Story เล่ม 1" GAEEPD='{"price":90}'></a><div class="product_price" realprice="90"></div><div class="product_price_old" realprice="120"></div>`,
  );
  assert.equal(firstpage[0].msrp, 120);
  const phoenix = parseCatalog(
    "phoenix",
    '<a class="product-item-link" href="https://www.phoenixnext.com/story-1.html">Story เล่ม 1</a><span data-price-type="finalPrice" data-price-amount="90"></span><span data-price-type="oldPrice" data-price-amount="120"></span>',
  );
  assert.equal(phoenix[0].msrp, 120);
  const saleOnly = parseCatalog(
    "phoenix",
    '<a class="product-item-link" href="https://www.phoenixnext.com/story-1.html">Story เล่ม 1</a><span data-price-amount="90"></span>',
  );
  assert.equal(saleOnly[0].msrp, "");
});
