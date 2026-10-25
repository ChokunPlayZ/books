import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import { SCRAPER_SOURCES } from "../../lib/server/scrapers/registry.ts";
import { lowestPrices, priceAvailability } from "../../lib/domain/prices.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
const isbn = "9786166247275";
function database(t) {
  const store = openStore(":memory:");
  t.after(() => store.close());
  return store;
}
function source(id, load) {
  return {
    id,
    hosts: [id + ".example"],
    priceSource: {
      name: id,
      currency: "THB",
      searchUrl: (code) => `https://${id}.example/search?q=${code}`,
    },
    create: () => ({ lookupIsbn: load }),
  };
}
const details = (id, values = {}) => ({
  isbn,
  title: "Same edition",
  url: `https://${id}.example/book`,
  price: 100,
  currency: "THB",
  availability: "In stock",
  ...values,
});

test("price comparison verifies ISBNs, distinguishes outages, and only ranks known in-stock prices within each currency", async (t) => {
  const definitions = [
    source("regular", async () => details("regular", { price: 200 })),
    source("cheapest", async () => details("cheapest", { price: 150 })),
    source("tied", async () => details("tied", { price: 150 })),
    source("soldout", async () =>
      details("soldout", { price: 1, availability: "Out of stock" }),
    ),
    source("unknown", async () =>
      details("unknown", { price: 2, availability: "" }),
    ),
    source("preorder", async () =>
      details("preorder", { price: 3, availability: "Pre-order" }),
    ),
    source("foreign", async () =>
      details("foreign", { price: 8, currency: "USD" }),
    ),
    source("missingprice", async () => details("missingprice", { price: "" })),
    source("different", async () =>
      details("different", { isbn: "9780385496490" }),
    ),
    source("missing", async () => null),
    source("offline", async () => {
      throw new Error("Offline");
    }),
    source("unsafe", async () =>
      details("unsafe", { url: "https://elsewhere.example/book" }),
    ),
    source("invalidprice", async () => details("invalidprice", { price: -1 })),
  ];
  const api = createCatalogService(
    database(t),
    () => assert.fail("No network expected"),
    definitions,
  );
  const result = await api.findLowestPrices({
    isbn: "ISBN: 978-616-624-727-5",
  });
  assert.equal(result.isbn, isbn);
  assert.equal(result.offers.length, 9);
  assert.equal(result.offers[0].shopId, "cheapest");
  assert.deepEqual(
    [...lowestPrices(result.offers)],
    [
      ["THB", 150],
      ["USD", 8],
    ],
  );
  assert.equal(
    result.offers.find((offer) => offer.shopId === "missingprice").price,
    null,
  );
  assert.equal(
    result.offers.find((offer) => offer.shopId === "invalidprice").price,
    null,
  );
  assert.equal(
    result.sources.find((entry) => entry.id === "different").status,
    "not_found",
  );
  assert.equal(
    result.sources.find((entry) => entry.id === "missing").status,
    "not_found",
  );
  assert.equal(
    result.sources.find((entry) => entry.id === "offline").status,
    "unavailable",
  );
  assert.equal(
    result.sources.find((entry) => entry.id === "unsafe").status,
    "unavailable",
  );
});

test("prices are cached across services, concurrent checks share work, refresh bypasses metadata caching, and failures do not become low prices", async (t) => {
  const store = database(t);
  let calls = 0,
    price = 125,
    failed = false;
  const definitions = [
    source("shop", async (code, refresh) => {
      calls++;
      assert.equal(code, isbn);
      assert.equal(refresh, true);
      if (failed) throw new Error("Unavailable");
      return details("shop", { price });
    }),
  ];
  const api = createCatalogService(store, fetch, definitions);
  const first = await Promise.all([
    api.findLowestPrices({ isbn }),
    api.findLowestPrices({ isbn }),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first[0], first[1]);
  price = 100;
  const restarted = createCatalogService(store, fetch, definitions);
  assert.deepEqual(await restarted.findLowestPrices({ isbn }), first[0]);
  assert.equal(calls, 1);
  const fresh = await restarted.findLowestPrices({ isbn, refresh: true });
  assert.equal(fresh.offers[0].price, 100);
  assert.equal(calls, 2);
  failed = true;
  const outage = await restarted.findLowestPrices({ isbn, refresh: true });
  assert.deepEqual(outage.offers, []);
  assert.equal(outage.sources[0].status, "unavailable");
  await restarted.findLowestPrices({ isbn, refresh: true });
  assert.equal(calls, 3, "Failed refreshes respect the source retry cooldown");
});

test("invalid and missing ISBNs are rejected before any shop lookup", async (t) => {
  const api = createCatalogService(database(t), fetch, [
    source("shop", () => assert.fail("Must not search")),
  ]);
  for (const input of [undefined, {}, { isbn: "" }, { isbn: "9781234567890" }])
    await assert.rejects(api.findLowestPrices(input), /valid ISBN/);
});

for (const [id, code, searchFixture, productFixture, price, stock] of [
  ["naiin", isbn, "naiin-search.html", "naiin-detail.html", 166.25, "in_stock"],
  ["kinokuniya", "9780385496490", "", "kinokuniya-book.html", 355, "in_stock"],
  [
    "firstpage",
    "9786164897397",
    "firstpage-isbn-search.html",
    "firstpage-isbn-product.html",
    180,
    "in_stock",
  ],
  [
    "phoenix",
    "9786166247404",
    "phoenix.html",
    "phoenix-isbn-product.html",
    370,
    "unknown",
  ],
  [
    "animag",
    "9786163377302",
    "animag-search.html",
    "animag-product.html",
    320,
    "in_stock",
  ],
  [
    "dexpress",
    "9786163634627",
    "dexpress-search.html",
    "dexpress-product.html",
    264,
    "in_stock",
  ],
]) {
  test(
    id + " extracts the verified product's selling price and stock",
    async (t) => {
      const api = createCatalogService(
        database(t),
        async (url) =>
          new Response(
            fixture(
              searchFixture && /search|catalogsearch/.test(url)
                ? searchFixture
                : productFixture,
            ),
          ),
        SCRAPER_SOURCES.filter((entry) => entry.id === id),
      );
      const result = await api.findLowestPrices({ isbn: code });
      assert.equal(result.sources[0].status, "found");
      assert.equal(result.offers[0].isbn, code);
      assert.equal(result.offers[0].price, price);
      assert.equal(result.offers[0].currency, "THB");
      assert.equal(result.offers[0].availability, stock);
    },
  );
}

test("Naiin sale prices and another shop can be compared through the application API without downloading covers", async (t) => {
  const store = database(t);
  const api = createApplicationApi(
    store,
    { ensure: () => assert.fail("Prices must not fetch cover images") },
    async (url) => {
      if (url.includes("naiin.com"))
        return new Response(
          fixture(
            url.includes("search-result")
              ? "naiin-search.html"
              : "naiin-detail.html",
          ),
        );
      if (url.includes("kinokuniya.co.th"))
        return new Response(
          fixture("kinokuniya-book.html").replaceAll("9780385496490", isbn),
        );
      if (url.includes("firstpagepro.com"))
        return new Response('<span class="tsk-all">0</span>');
      if (url.includes("animagshop.com"))
        return new Response(fixture("animag-empty.html"));
      if (url.includes("dexpress-shop.com"))
        return new Response(fixture("dexpress-empty.html"));
      if (url.includes("phoenixnext.com"))
        return new Response('<div class="message info empty">Empty</div>');
      assert.fail("Unexpected source " + url);
    },
  );
  const result = await api.findLowestPrices({ isbn });
  assert.equal(result.sources.length, 6);
  assert.equal(result.offers.length, 2);
  assert.deepEqual([...lowestPrices(result.offers)], [["THB", 166.25]]);
});

test("stock normalization preserves unknown states instead of assuming availability", () => {
  assert.equal(priceAvailability("https://schema.org/InStock"), "in_stock");
  assert.equal(
    priceAvailability("http://schema.org/OutOfStock"),
    "out_of_stock",
  );
  assert.equal(priceAvailability("Pre-order"), "preorder");
  for (const value of ["", undefined, "Check availability", "new status"])
    assert.equal(priceAvailability(value), "unknown");
});

test("a Naiin recommendation cannot attach a different book's price to the requested ISBN", async (t) => {
  const wrongProduct =
    fixture("naiin-detail.html").replaceAll(isbn, "9780385496490") +
    `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      isbn,
      name: "Recommendation",
      url: "https://www.naiin.com/product/detail/999",
    })}</script>`;
  const api = createCatalogService(
    database(t),
    async (url) =>
      new Response(
        url.includes("search-result")
          ? fixture("naiin-search.html")
          : wrongProduct,
      ),
    SCRAPER_SOURCES.filter((entry) => entry.id === "naiin"),
  );
  const result = await api.findLowestPrices({ isbn });
  assert.deepEqual(result.offers, []);
  assert.equal(result.sources[0].status, "not_found");
});

test("a Phoenix recommendation cannot establish the main book's stock", async (t) => {
  const product =
    fixture("phoenix-isbn-product.html") +
    `<div class="stock available">In stock</div><script type="application/ld+json">${JSON.stringify(
      {
        "@type": "Product",
        name: "Recommendation",
        url: "https://www.phoenixnext.com/other.html",
        offers: { availability: "https://schema.org/InStock" },
      },
    )}</script>`;
  const api = createCatalogService(
    database(t),
    async (url) =>
      new Response(
        url.includes("catalogsearch") ? fixture("phoenix.html") : product,
      ),
    SCRAPER_SOURCES.filter((entry) => entry.id === "phoenix"),
  );
  const result = await api.findLowestPrices({ isbn: "9786166247404" });
  assert.equal(result.offers[0].availability, "unknown");
  assert.equal(lowestPrices(result.offers).size, 0);
});

test("an explicit zero price is preserved and can be the lowest in-stock offer", async (t) => {
  const api = createCatalogService(database(t), fetch, [
    source("free", async () => details("free", { price: 0 })),
  ]);
  const result = await api.findLowestPrices({ isbn });
  assert.equal(result.offers[0].price, 0);
  assert.equal(lowestPrices(result.offers).get("THB"), 0);
});
