import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { SCRAPER_SOURCES } from "../../lib/server/scrapers/registry.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
const isbn = "9786166247275";
function memoryStore() {
  const values = new Map();
  return {
    cache: {
      get: (key) => values.get(key) || null,
      put: (key, value) => values.set(key, value),
    },
  };
}

for (const [id, code, searchFixture, productFixture, price, stock] of [
  ["naiin", isbn, "naiin-search.html", "naiin-detail.html", 166.25, "In stock"],
  [
    "kinokuniya",
    "9780385496490",
    "",
    "kinokuniya-book.html",
    355,
    "http://schema.org/InStock",
  ],
  [
    "firstpage",
    "9786164897397",
    "firstpage-isbn-search.html",
    "firstpage-isbn-product.html",
    180,
    "https://schema.org/InStock",
  ],
  [
    "phoenix",
    "9786166247404",
    "phoenix.html",
    "phoenix-isbn-product.html",
    370,
    "",
  ],
  [
    "animag",
    "9786163377302",
    "animag-search.html",
    "animag-product.html",
    320,
    "https://schema.org/InStock",
  ],
  [
    "dexpress",
    "9786163634627",
    "dexpress-search.html",
    "dexpress-product.html",
    264,
    "In stock",
  ],
]) {
  test(
    id +
      " retains the verified product's selling price and stock in ISBN metadata",
    async () => {
      const api = createCatalogService(
        memoryStore(),
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
      const result = await api.lookupIsbn(code);
      assert.equal(result.found, true);
      assert.equal(result.details.isbn, code);
      assert.equal(result.details.price, price);
      assert.equal(result.details.availability, stock);
    },
  );
}

test("a Naiin recommendation cannot attach a different book's metadata to the requested ISBN", async () => {
  const wrongProduct =
    fixture("naiin-detail.html").replaceAll(isbn, "9780385496490") +
    `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      isbn,
      name: "Recommendation",
      url: "https://www.naiin.com/product/detail/999",
    })}</script>`;
  const api = createCatalogService(
    memoryStore(),
    async (url) =>
      new Response(
        url.includes("search-result")
          ? fixture("naiin-search.html")
          : wrongProduct,
      ),
    SCRAPER_SOURCES.filter((entry) => entry.id === "naiin"),
  );
  const result = await api.lookupIsbn(isbn);
  assert.equal(result.found, false);
  assert.equal(result.details, null);
});

test("a Phoenix recommendation cannot establish the main book's stock", async () => {
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
    memoryStore(),
    async (url) =>
      new Response(
        url.includes("catalogsearch") ? fixture("phoenix.html") : product,
      ),
    SCRAPER_SOURCES.filter((entry) => entry.id === "phoenix"),
  );
  const result = await api.lookupIsbn("9786166247404");
  assert.equal(result.found, true);
  assert.equal(result.details.availability, "");
});
