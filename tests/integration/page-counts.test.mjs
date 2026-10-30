import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parsePageCount,
  normalizePageCount,
} from "../../lib/domain/page-count.ts";
import { kinokuniyaBook } from "../../lib/domain/kinokuniya.ts";
import { yenPressBook } from "../../lib/domain/yenpress.ts";
import { kodanshaBook } from "../../lib/domain/kodansha.ts";
import { hanmotoBook } from "../../lib/domain/hanmoto.ts";
import { firstPageBook } from "../../lib/domain/firstpage.ts";
import { googleBooks } from "../../lib/server/scrapers/google-books.ts";
import { openLibrary } from "../../lib/server/scrapers/open-library.ts";
import { naiin } from "../../lib/server/scrapers/naiin.ts";
import { openStore } from "../../lib/server/store.ts";
import { parseImport } from "../../lib/server/importer.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );

test("page counts accept explicit localized totals and leave missing, ambiguous and invalid counts blank", () => {
  for (const value of [
    208,
    "208",
    "208 p.",
    "208 pages",
    "208 หน้า",
    "208ページ",
    "２０８頁",
  ])
    assert.equal(parsePageCount(value), 208);
  assert.equal(parsePageCount("1,024 pages"), 1024);
  for (const value of [
    undefined,
    null,
    "",
    0,
    -1,
    1.5,
    "200–208",
    "208 + 4",
    "1,02",
    "about 208",
    true,
    [],
    {},
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.equal(parsePageCount(value), "");
  assert.equal(normalizePageCount(" 208 "), 208);
  assert.equal(normalizePageCount(""), "");
  assert.throws(() => normalizePageCount("208 pages"), /positive whole number/);
});

test("publisher parsers read pages from the verified edition, excluding neighboring editions and recommendations", () => {
  assert.equal(
    kinokuniyaBook(fixture("kinokuniya-book.html"), "9780385496490").pageCount,
    208,
  );
  const comic = fixture("yenpress-comic.html").replace(
    "320  pages",
    "321 pages",
  );
  const printUrl =
    "https://yenpress.com/titles/9781975319434-solo-leveling-vol-1-comic";
  assert.equal(yenPressBook(comic, "9781975319434", printUrl).pageCount, 321);
  assert.equal(yenPressBook(comic, "9781975319441", printUrl).pageCount, 320);
  assert.equal(
    kodanshaBook(
      fixture("kodansha-product.html"),
      "9784065134009",
      "https://www.kodansha.co.jp/comic/products/0000314505",
    ).pageCount,
    208,
  );
  assert.equal(
    hanmotoBook(fixture("hanmoto-domestic-1.html"), "9784063951370").pageCount,
    192,
  );
  const first = fixture("firstpage-isbn-product.html");
  const url = "https://www.firstpagepro.com/product/1085";
  const related =
    '<script type="application/ld+json">{"sku":"9786164897397","url":"https://www.firstpagepro.com/product/9999","numberOfPages":999}</script>';
  assert.equal(
    firstPageBook(first + related, "9786164897397", url).pageCount,
    "",
  );
  assert.equal(
    firstPageBook(
      first.replace(
        '"description": ""',
        '"numberOfPages": 192, "description": ""',
      ) + related,
      "9786164897397",
      url,
    ).pageCount,
    192,
  );
});

test("API providers read their page-count fields and Naiin reads its labeled detail field", async () => {
  const isbn = "9780385496490";
  const google = googleBooks.create({
    fetchJson: async () => ({
      items: [
        {
          volumeInfo: {
            title: "Wrong edition",
            pageCount: 999,
            industryIdentifiers: [{ identifier: "9780140328721" }],
          },
        },
        {
          volumeInfo: {
            title: "Verified",
            pageCount: 208,
            industryIdentifiers: [{ identifier: isbn }],
          },
        },
      ],
    }),
  });
  assert.equal((await google.lookupIsbn(isbn)).pageCount, 208);
  const open = openLibrary.create({
    fetchJson: async () => ({
      ["ISBN:" + isbn]: { title: "Verified", number_of_pages: 192 },
    }),
  });
  assert.equal((await open.lookupIsbn(isbn)).pageCount, 192);
  const detail =
    fixture("naiin-detail.html") +
    '<label class="product-label tw:flex-auto">จำนวนหน้า</label><p class="product-label-detail tw:flex-none">192 หน้า</p>';
  const source = naiin.create({
    fetchText: async (url) =>
      url.includes("search-result") ? fixture("naiin-search.html") : detail,
  });
  assert.equal((await source.lookupIsbn("9786166247275")).pageCount, 192);
});

test("page count enrichment preserves preferred metadata, respects priorities and bypasses old cached results", async (t) => {
  for (const [preferredPages, expected] of [
    [undefined, 208],
    [320, 320],
    [0, 208],
  ]) {
    const store = openStore(":memory:");
    t.after(() => store.close());
    const isbn = "9780385496490";
    store.cache.put(
      "isbn:v14:" + isbn,
      JSON.stringify({ found: true, details: { title: "Old cache" } }),
      86400,
    );
    const source = (id, isbnPriority, details) => ({
      id,
      isbnPriority,
      hosts: [],
      create: () => ({ lookupIsbn: async () => details }),
    });
    const sources = [
      source("preferred", 1, {
        title: "Preferred",
        publisher: "Publisher",
        pageCount: preferredPages,
      }),
      source("wrong-edition", 2, {
        title: "Wrong edition",
        isbn: "9780140328721",
        pageCount: 999,
      }),
      source("fallback", 3, { title: "Fallback", isbn, pageCount: 208 }),
      source("later", 4, { title: "Later", pageCount: 260 }),
    ];
    const service = createCatalogService(
      store,
      () => assert.fail("No network needed"),
      sources,
    );
    const result = await service.lookupIsbn(isbn);
    assert.equal(result.details.title, "Preferred");
    assert.equal(result.details.publisher, "Publisher");
    assert.equal(result.details.pageCount, expected);
    assert.deepEqual(result.warnings, []);
    const offline = createCatalogService(
      store,
      () => assert.fail("Use enriched cache"),
      [],
    );
    assert.deepEqual(await offline.lookupIsbn(isbn), result);
  }
});

test("series edits can set and clear pages, reject invalid batches atomically and round-trip JSON imports", (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  const data = {
    series: "Pages",
    type: "Manga (EN)",
    status: "Read",
    pageCount: "208",
  };
  store.api.saveBook({ requestId: "page_count_create", book: data });
  let book = store.api.getCollection().books[0];
  const edit = (pages, id) =>
    store.api.saveSeriesVolumes({
      requestId: "page_count_" + id,
      series: "Pages",
      changes: [
        { row: book.row, token: book.token, book: { pageCount: pages } },
      ],
    });
  edit(260, "edit");
  book = store.api.getCollection().books[0];
  assert.equal(book.pageCount, 260);
  assert.throws(() => edit(1.5, "invalid"), /positive whole number/);
  assert.equal(store.api.getCollection().books[0].token, book.token);
  const plan = parseImport(Buffer.from(JSON.stringify([book])), "books.json");
  assert.equal(plan.books[0].pageCount, 260);
  edit("", "clear");
  assert.equal(store.api.getCollection().books[0].pageCount, "");
});
