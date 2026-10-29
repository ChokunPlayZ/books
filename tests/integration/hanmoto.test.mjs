import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hanmotoBook } from "../../lib/domain/hanmoto.ts";
import { safeCoverUrl } from "../../lib/domain/urls.ts";
import { hanmoto } from "../../lib/server/scrapers/hanmoto.ts";
import { googleBooks } from "../../lib/server/scrapers/google-books.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import { createCoverService } from "../../lib/server/covers.ts";
import { openStore } from "../../lib/server/store.ts";

const fixture = (volume) =>
  readFileSync(
    new URL(
      `../fixtures/publishers/hanmoto-domestic-${volume}.html`,
      import.meta.url,
    ),
    "utf8",
  );
const first = fixture(1),
  last = fixture(28);
const isbn = "9784063951370";
const page = "https://www.hanmoto.com/bd/isbn/" + isbn;
const image = hanmotoBook(first, isbn).coverUrl;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
function database(t) {
  const store = openStore(":memory:");
  t.after(() => store.close());
  return store;
}
function save(store, overrides = {}) {
  store.api.saveBook({
    requestId: "hanmoto_save_" + (overrides.volume || 1),
    book: {
      series: "Domestic na Kanojo",
      type: "Manga (JP)",
      publisher: "Kodansha",
      status: "Un Sealed",
      volume: 1,
      isbn,
      ...overrides,
    },
  });
}

test("Hanmoto reads real Japanese edition covers and omits ruby readings from the title", () => {
  const details = hanmotoBook(first, isbn);
  assert.equal(details.title, "ドメスティックな彼女（1）");
  assert.equal(details.publisher, "講談社");
  assert.equal(details.authors, "流石 景");
  assert.equal(details.releaseDate, "2014-07-17");
  assert.equal(details.source, "Hanmoto");
  assert.equal(details.url, page);
  assert.match(
    details.coverUrl,
    /^https:\/\/img\.hanmoto\.com\/bd\/img\/9784063951370_600\.jpg\?lastupdated=/,
  );
  const final = hanmotoBook(last, "9784065203385");
  assert.equal(final.title, "ドメスティックな彼女（28）");
  assert.match(final.coverUrl, /9784065203385_600\.jpg/);
});

test("Hanmoto rejects wrong editions, changed identities, placeholders and recommendation covers", () => {
  assert.equal(hanmotoBook(first, "9784065203385"), null);
  assert.throws(
    () => hanmotoBook("<h1>Maintenance</h1>", isbn),
    /ISBN unavailable/,
  );
  assert.throws(
    () =>
      hanmotoBook(
        first.replace(
          'data-book-isbn13="' + isbn,
          'data-book-isbn13="9784065203385',
        ),
        isbn,
      ),
    /identity unavailable/,
  );
  assert.throws(
    () =>
      hanmotoBook(
        first.replaceAll("<h1", "<h2").replaceAll("</h1", "</h2"),
        isbn,
      ),
    /title unavailable/,
  );
  for (const cover of [
    "https://img.hanmoto.com/bd/img/noimage.jpg",
    "https://img.hanmoto.com/bd/img/9784065203385_600.jpg",
    "https://books.google.com/unrelated.jpg",
    "https://evil.test/9784063951370.jpg",
  ])
    assert.equal(hanmotoBook(first.replace(image, cover), isbn).coverUrl, "");
  for (const cover of [
    "https://img.hanmoto.com.evil.test/bd/img/9784063951370_600.jpg",
    "https://user:password@img.hanmoto.com/bd/img/9784063951370_600.jpg",
    "https://img.hanmoto.com:444/bd/img/9784063951370_600.jpg",
    "https://img.hanmoto.com/private.jpg",
    "https://img.hanmoto.com/bd/img/noimage.jpg",
  ])
    assert.equal(safeCoverUrl(cover), "");
  assert.equal(safeCoverUrl(image), image);
});

test("registered Hanmoto lookup bypasses old misses, shares ISBN-10 requests and reuses cached cover choices", async (t) => {
  const store = database(t),
    calls = [];
  save(store);
  store.cache.put("isbn:v10:" + isbn, JSON.stringify({ found: false }), 86400);
  store.cache.put("cover:miss:v7:" + isbn, "1", 86400);
  const service = createCatalogService(
    store,
    async (url, options) => {
      calls.push(url);
      assert.equal(url, page);
      assert.equal(options.redirect, "manual");
      assert.equal(options.cache, "no-store");
      return new Response(first);
    },
    [hanmoto],
  );
  const [cover, lookup] = await Promise.all([
    service.getBookCover({ row: 1 }),
    service.lookupIsbn("4063951375"),
  ]);
  assert.equal(cover.coverUrl, image);
  assert.equal(lookup.details.source, "Hanmoto");
  assert.deepEqual(calls, [page]);
  const offline = createCatalogService(
    store,
    () => assert.fail("Use durable cached details"),
    [hanmoto],
  );
  assert.equal(
    (await offline.getBookCoverOptions({ row: 1 })).covers[0].coverUrl,
    image,
  );
  assert.equal((await offline.lookupIsbn(isbn)).details.coverUrl, image);
});

test("Hanmoto skips missing and non-Japanese ISBNs without network requests", async (t) => {
  const store = database(t);
  save(store, { volume: 20, isbn: "" });
  save(store, { volume: 21, isbn: "9780385496490" });
  const service = createCatalogService(
    store,
    () => assert.fail("This ISBN does not use Hanmoto"),
    [hanmoto],
  );
  for (const book of store.api.getCollection().books) {
    assert.deepEqual(
      (await service.getBookCoverOptions({ row: book.row })).covers,
      [],
    );
    assert.equal((await service.getBookCover({ row: book.row })).coverUrl, "");
  }
});

test("Hanmoto failures preserve Google Books fallback and a durable retry cooldown", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const store = database(t);
  save(store);
  let calls = 0,
    unavailable = true;
  const fetchImpl = async (url) => {
    if (url === page) {
      calls++;
      return unavailable
        ? new Response("Unavailable", { status: 503 })
        : new Response(first);
    }
    return Response.json({
      items: [
        {
          volumeInfo: {
            title: "Fallback",
            industryIdentifiers: [{ identifier: isbn }],
          },
        },
      ],
    });
  };
  let service = createCatalogService(store, fetchImpl, [hanmoto, googleBooks]);
  const lookup = await service.lookupIsbn(isbn);
  assert.equal(lookup.details.source, "Google Books");
  assert.deepEqual(lookup.warnings, ["Hanmoto is unavailable right now."]);
  service = createCatalogService(store, fetchImpl, [hanmoto, googleBooks]);
  const choices = await service.getBookCoverOptions({ row: 1, refresh: true });
  assert.deepEqual(choices.warnings, [
    "Could not check Hanmoto for this ISBN.",
  ]);
  assert.equal(calls, 1);
  unavailable = false;
  t.mock.timers.tick(15 * 60 * 1000);
  assert.equal((await service.lookupIsbn(isbn)).details.source, "Hanmoto");
  assert.equal(calls, 2);
});

test("Hanmoto 404s are cached, while malformed pages and unsafe redirects remain failures", async (t) => {
  for (const response of [
    () => new Response("Missing", { status: 404 }),
    () => new Response("<h1>Maintenance</h1>"),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.test/" },
      }),
  ]) {
    const store = database(t),
      calls = [];
    save(store);
    const service = createCatalogService(
      store,
      async (url) => {
        calls.push(url);
        return response();
      },
      [hanmoto],
    );
    const lookup = await service.lookupIsbn(isbn);
    assert.equal(lookup.found, false);
    assert.equal(lookup.warnings.length, response().status === 404 ? 0 : 1);
    await service.getBookCoverOptions({ row: 1 });
    assert.deepEqual(calls, [page]);
  }
});

test("default application finds and stores Hanmoto covers with the existing publisher link and offline reuse", async (t) => {
  const store = database(t),
    calls = [];
  const publisherUrl = "https://www.kodansha.co.jp/book/products/" + isbn;
  save(store, { publisherUrl });
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === page) return new Response(first);
    if (url === image) return new Response(png);
    return new Response("Missing", { status: 404 });
  };
  const covers = createCoverService(store, { fetchImpl });
  const api = createApplicationApi(store, covers, fetchImpl);
  const options = await api.getBookCoverOptions({ row: 1 });
  assert.equal(options.covers.length, 1);
  const choice = options.covers[0];
  assert.equal(choice.source, "Hanmoto");
  assert.equal(choice.sourceUrl, page);
  assert.equal(choice.publisherUrl, publisherUrl);
  assert.deepEqual(covers.get(choice.coverId).body, png);
  const automatic = await api.getBookCover({ row: 1 });
  assert.equal(automatic.coverId, choice.coverId);
  assert.equal(store.api.getCollection().books[0].publisherUrl, publisherUrl);
  assert.equal(calls.filter((url) => url === page).length, 1);
  assert.equal(calls.filter((url) => url === image).length, 1);
  const offline = createApplicationApi(store, covers, () =>
    assert.fail("Use saved cover bytes"),
  );
  assert.equal(
    (await offline.getBookCover({ row: 1 })).coverId,
    choice.coverId,
  );
  assert.equal(
    (await offline.getBookCoverOptions({ row: 1 })).covers[0].coverId,
    choice.coverId,
  );
});
