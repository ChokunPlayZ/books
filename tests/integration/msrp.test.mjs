import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openTestStore as openStore } from "../helpers/database.mjs";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { SCRAPER_SOURCES } from "../../lib/server/scrapers/registry.ts";
import { kodanshaBook } from "../../lib/domain/kodansha.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
for (const [source, isbn, search, product, msrp, price] of [
  [
    "naiin",
    "9786166247275",
    "naiin-search.html",
    "naiin-detail.html",
    175,
    166.25,
  ],
  [
    "dexpress",
    "9786163634627",
    "dexpress-search.html",
    "dexpress-product.html",
    279,
    264,
  ],
  [
    "animag",
    "9786163377302",
    "animag-search.html",
    "animag-product.html",
    340,
    320,
  ],
]) {
  test(
    source + " scrapes MSRP separately from its discounted shop price",
    async (t) => {
      const store = await openStore();
      t.after(async () => await store.close());
      const catalogs = createCatalogService(
        store,
        async (url) =>
          new Response(fixture(/search/.test(url) ? search : product)),
        SCRAPER_SOURCES.filter((item) => item.id === source),
      );
      const result = await catalogs.lookupIsbn(isbn);
      assert.equal(result.details.msrp, msrp);
      assert.equal(result.details.msrpCurrency, "THB");
      assert.equal(result.details.price, price);
    },
  );
}

test("Japanese publisher MSRP uses the tax-inclusive list price rather than the base price", () => {
  const html = fixture("kodansha-product.html");
  const isbn =
    /name=["']books:isbn["'][^>]*content=["']([^"']+)/i.exec(html)?.[1] ||
    /content=["']([^"']+)["'][^>]*name=["']books:isbn/i.exec(html)?.[1];
  const url = /property=["']og:url["'][^>]*content=["']([^"']+)/i.exec(
    html,
  )?.[1];
  const book = kodanshaBook(html, isbn, url);
  assert.equal(book.msrp, 627);
  assert.equal(book.msrpCurrency, "JPY");
});
