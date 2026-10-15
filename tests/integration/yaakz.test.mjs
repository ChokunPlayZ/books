import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import { createCoverService } from "../../lib/server/covers.ts";
import { yaakzProducts, yaakzItems } from "../../lib/server/yaakz.ts";
import {
  publisherKey,
  safeProductUrl,
  safeSeriesCatalogUrl,
} from "../../lib/domain.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
const product = fixture("yaakz-product.html");
const listing = fixture("yaakz-list.json");
const volume = {
  series: "DANDADAN",
  volume: 1,
  type: "Manga (TH)",
  publisher: "Siam Inter Comics",
  status: "Read",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);

test("Yaakz reads individual Nuxt product variants with their own ISBN, image and canonical URL", () => {
  const items = yaakzItems(yaakzProducts(product)[0]);
  assert.equal(items[0].volume, 1);
  assert.equal(items[0].isbn, "9786165890830");
  assert.equal(items[0].coverUrl, "https://du.lnwfile.com/vdjnpn.jpg");
  assert.equal(items[0].url, "https://www.yaakz.com/product/11000408800014925");
  assert.equal(items[0].type, "Manga (TH)");
  assert.notEqual(items[0].coverUrl, items[1].coverUrl);
  assert.equal(publisherKey("SIC"), "yaakz");
  assert.equal(publisherKey("สยามอินเตอร์คอมิกส์"), "yaakz");
  assert.equal(
    safeProductUrl(
      "https://www.yaakz.com/product/dandadan/11000408800014925",
      "yaakz",
    ),
    items[0].url,
  );
  assert.equal(
    safeSeriesCatalogUrl("https://www.yaakz.com/search?q=DANDADAN", "yaakz"),
    "https://www.yaakz.com/search?q=DANDADAN",
  );
  assert.equal(
    safeProductUrl("https://www.yaakz.com.evil.test/product/1", "yaakz"),
    "",
  );
  assert.equal(
    safeSeriesCatalogUrl(
      "https://www.yaakz.com/search?q=test&redirect=https://evil.test",
      "yaakz",
    ),
    "",
  );
});

test("Yaakz releases, discovery, series catalogs and cover choices support variant products and durable outages", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  store.api.saveBook({ requestId: "yaakz_volume_test_1", book: volume });
  let offline = false;
  const calls = [];
  const service = createCatalogService(store, async (url) => {
    calls.push(url);
    if (offline) return new Response("Offline", { status: 503 });
    if (url.includes("/api/products")) return new Response(listing);
    if (url.includes("/product/")) return new Response(product);
    return new Response('<product-list :items="[]">');
  });
  const feed = await service.getPublisherReleases({ publisherId: "yaakz" });
  assert.deepEqual(
    feed.items.map((item) => item.volume),
    [1, 2],
  );
  assert.ok(feed.items.every((item) => !item.bundle && !item.special));
  const discovery = await service.getPublisherDirectory({
    url: "https://www.yaakz.com/",
  });
  assert.equal(discovery.items.length, 2);
  const spec = { publisherId: "yaakz", series: "DANDADAN", type: "Manga (TH)" };
  const catalog = await service.getSeriesCatalog(spec);
  assert.equal(catalog.complete, true);
  assert.ok(catalog.items.every((item) => !item.catalogVariant));
  const options = await service.getBookCoverOptions({ row: 1 });
  assert.deepEqual(
    options.covers.map((cover) => cover.coverUrl),
    ["https://du.lnwfile.com/vdjnpn.jpg"],
  );
  assert.equal(options.covers[0].source, "Yaakz");
  assert.equal(
    (await service.getBookCover({ row: 1 })).coverUrl,
    "https://du.lnwfile.com/vdjnpn.jpg",
  );
  assert.ok(
    calls.some(
      (url) => new URL(url).searchParams.get("filter[q]") === "DANDADAN",
    ),
  );
  offline = true;
  const stale = await service.getPublisherReleases({
    publisherId: "yaakz",
    refresh: true,
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.items[0].coverUrl, feed.items[0].coverUrl);
});

test("bookstores provide stored cover choices for unsupported publishers and reject a different ISBN", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const isbn = "9786165890830";
  store.api.saveBook({
    requestId: "shop_cover_test_1",
    book: { ...volume, publisher: "Other publisher", isbn },
  });
  const image = "https://storage.naiin.com/cover.png";
  const candidates = [
    { ProductTypeId: 1, ProductID: 1, ProductName: "DANDADAN เล่ม 1" },
  ];
  let correct = true;
  const fetchImpl = async (url) => {
    if (url.includes("search-result"))
      return new Response(
        `<product-list :items='${JSON.stringify(candidates)}'>`,
      );
    if (url.includes("naiin.com/product"))
      return new Response(
        `<script type="application/ld+json">${JSON.stringify({ "@type": "Book", name: "DANDADAN เล่ม 1", isbn: correct ? isbn : "9780140328721", image })}</script>`,
      );
    if (url.includes("/api/products"))
      return new Response(JSON.stringify({ data: [], total: 0 }));
    return new Response(png);
  };
  const covers = createCoverService(store, { fetchImpl });
  const api = createApplicationApi(store, covers, fetchImpl);
  const options = await api.getBookCoverOptions({ row: 1 });
  assert.equal(options.covers.length, 1);
  assert.equal(options.covers[0].source, "Naiin");
  assert.match(options.covers[0].coverId, /^[a-f0-9]{64}$/);
  assert.deepEqual(covers.get(options.covers[0].coverId).body, png);
  correct = false;
  assert.equal((await api.getBookCoverOptions({ row: 1 })).covers.length, 0);
});

test("ISBN metadata falls back to Yaakz and verifies the child ISBN before accepting a cover", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const service = createCatalogService(store, async (url) => {
    if (url.includes("naiin"))
      return new Response('<product-list :items="[]">');
    if (url.includes("/api/products")) return new Response(listing);
    if (url.includes("yaakz.com/product")) return new Response(product);
    return new Response("{}");
  });
  const result = await service.lookupIsbn("9786165890830");
  assert.equal(result.details.source, "Yaakz");
  assert.equal(result.details.volume, 1);
  assert.equal(result.details.coverUrl, "https://du.lnwfile.com/vdjnpn.jpg");
  assert.equal((await service.lookupIsbn("9780140328721")).found, false);
});

test("Yaakz pagination uses bounded page numbers and rejects incomplete or changed product data", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const calls = [];
  const one = {
    uuid: "12345",
    title: "(มังงะ) Page story เล่ม 1",
    images: "https://du.lnwfile.com/1.jpg",
  };
  const service = createCatalogService(store, async (url) => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get("page"));
    return new Response(
      JSON.stringify({
        total: 21,
        data:
          page === 1
            ? Array.from({ length: 20 }, (_, index) => ({
                ...one,
                uuid: String(12300 + index),
                title: "(มังงะ) Page story เล่ม " + (index + 1),
              }))
            : [{ ...one, uuid: "12346", title: "(มังงะ) Page story เล่ม 21" }],
      }),
    );
  });
  const result = await service.getPublisherCatalog({
    url: "https://www.yaakz.com/category/books/976",
  });
  assert.equal(result.items.length, 21);
  assert.equal(result.pages, 2);
  assert.equal(result.complete, true);
  assert.deepEqual(
    calls.map((url) => new URL(url).searchParams.get("page")),
    ["1", "2"],
  );
  assert.throws(
    () => yaakzProducts("<script>doSomething()</script>"),
    /unavailable/,
  );
});
