import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { phoenixBook } from "../../lib/domain/phoenix.ts";
const fixture = (file) =>
  readFileSync(
    new URL("../fixtures/publishers/" + file, import.meta.url),
    "utf8",
  );
const isbn = "9786166247404";
const product = fixture("phoenix-isbn-product.html");
const url = "https://www.phoenixnext.com/ln0838-01.html";

test("Phoenix verifies the main product barcode and ignores search-card and recommendation ISBNs", () => {
  const book = phoenixBook(product, isbn, url);
  assert.equal(book.isbn, isbn);
  assert.equal(book.price, 370);
  assert.equal(book.type, "LN (TH)");
  assert.equal(book.title, "(LN) เส้นทางจาริกอาถรรพ์");
  assert.equal(
    phoenixBook(
      product.replaceAll(isbn, "9780140328721") +
        `<a href="?isbnet=${isbn}">Recommendation</a>`,
      isbn,
      url,
    ),
    null,
  );
  assert.equal(phoenixBook(product, isbn, "https://evil.test/book.html"), null);
  assert.throws(
    () => phoenixBook("<h1>Changed product</h1>", isbn, url),
    /ISBN details are unavailable/,
  );
});

test("Phoenix ISBN search covers the full catalog, canonicalizes input, verifies details and caches across services", async () => {
  const store = openStore(":memory:");
  try {
    const calls = [];
    const fetchImpl = async (address) => {
      calls.push(address);
      if (address.includes("catalogsearch"))
        return new Response(fixture("phoenix.html"));
      return new Response(product);
    };
    const api = createCatalogService(store, fetchImpl);
    const result = await api.searchPublisherIsbn({
      publisherId: "phoenix",
      isbn: "ISBN: 978-616-624-740-4",
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].isbn, isbn);
    assert.deepEqual(calls, [
      "https://www.phoenixnext.com/catalogsearch/result/?q=" + isbn,
      url,
    ]);
    await createCatalogService(store, fetchImpl).searchPublisherIsbn({
      publisherId: "phoenix",
      isbn,
    });
    assert.equal(calls.length, 2);
    await assert.rejects(
      () => api.searchPublisherIsbn({ publisherId: "unknown", isbn }),
      /Choose Phoenix/,
    );
    await assert.rejects(
      () =>
        api.searchPublisherIsbn({
          publisherId: "phoenix",
          isbn: "9786166247400",
        }),
      /not valid/,
    );
    assert.equal(calls.length, 2);
    assert.equal(store.api.getCollection().books.length, 0);
  } finally {
    store.close();
  }
});

test("First Page Pro ISBN search returns candidates without manufacturing verified ISBNs", async () => {
  const store = openStore(":memory:");
  try {
    let address;
    const api = createCatalogService(store, async (url) => {
      address = url;
      return new Response(fixture("firstpage.html"));
    });
    const result = await api.searchPublisherIsbn({
      publisherId: "firstpage",
      isbn: "0140328726",
    });
    assert.equal(
      address,
      "https://www.firstpagepro.com/search?q=9780140328721",
    );
    assert.equal(result.items.length, 2);
    assert.ok(result.items.every((item) => item.isbn === ""));
    assert.match(result.warnings.join(" "), /do not publish an ISBN/);
    assert.equal(store.api.getCollection().books.length, 0);
  } finally {
    store.close();
  }
});

test("empty searches are cached; failures and changed markup are not treated as confirmed misses", async () => {
  for (const publisherId of ["phoenix", "firstpage"]) {
    const store = openStore(":memory:");
    try {
      let calls = 0;
      const api = createCatalogService(store, async () => {
        calls++;
        return new Response(
          publisherId === "phoenix"
            ? '<div class="message info empty">Empty</div>'
            : '<span class="tsk-all">0</span>',
        );
      });
      assert.equal(
        (await api.searchPublisherIsbn({ publisherId, isbn })).items.length,
        0,
      );
      await api.searchPublisherIsbn({ publisherId, isbn });
      assert.equal(calls, 1);
    } finally {
      store.close();
    }
  }
  for (const response of [
    () => new Response("Source unavailable", { status: 503 }),
    () => new Response("Changed markup"),
  ]) {
    const store = openStore(":memory:");
    try {
      let calls = 0;
      const fetchImpl = async () => {
        calls++;
        return response();
      };
      const api = createCatalogService(store, fetchImpl);
      await assert.rejects(() =>
        api.searchPublisherIsbn({ publisherId: "firstpage", isbn }),
      );
      await assert.rejects(
        () =>
          createCatalogService(store, fetchImpl).searchPublisherIsbn({
            publisherId: "firstpage",
            isbn,
            refresh: true,
          }),
        /cooldown/,
      );
      assert.equal(calls, 1);
    } finally {
      store.close();
    }
  }
});

test("Phoenix search does not accept a fuzzy result whose product barcode differs", async () => {
  const store = openStore(":memory:");
  try {
    const api = createCatalogService(
      store,
      async (address) =>
        new Response(
          address.includes("catalogsearch")
            ? fixture("phoenix.html")
            : product.replaceAll(isbn, "9780140328721"),
        ),
    );
    assert.equal(
      (await api.searchPublisherIsbn({ publisherId: "phoenix", isbn })).items
        .length,
      0,
    );
  } finally {
    store.close();
  }
});
