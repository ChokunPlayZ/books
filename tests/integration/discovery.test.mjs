import test from "node:test";
import assert from "node:assert/strict";
import { discoverTitles } from "../../lib/client/matching.ts";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import {
  canonicalIsbn,
  releaseItem,
  parseCatalog,
  catalogTotal,
  publisherCatalogSource,
  safeCoverUrl,
  luckpimItem,
  cleanRelease,
  parsePublisherTitles,
} from "../../lib/domain.ts";

const url = "https://www.phoenixnext.com/gl.html";
const image = (name) =>
  `https://www.phoenixnext.com/media/catalog/product/${name}.jpg`;
const card = (name, title) =>
  `<article><a href="https://www.phoenixnext.com/${name}.html"><img src="${image(name)}"></a><a class="product-item-link" href="https://www.phoenixnext.com/${name}.html">${title}</a><span data-price-amount="175"></span></article>`;
const page1 =
  '<h1>Girl’s Love</h1><span class="toolbar-number">1</span><span class="toolbar-number">2</span><span class="toolbar-number">4</span>' +
  card("yuri-3", "(มังงะ) เรื่องใหม่ เล่ม 3") +
  card("yuri-special", "(มังงะ) Special Set เรื่องใหม่ เล่ม 1");
const page2 =
  '<span class="toolbar-number">4</span>' +
  card("yuri-1", "(มังงะ) เรื่องใหม่ เล่ม 1") +
  card("standalone", "(มังงะ) เรื่องสั้น");

function discovery(books = [], aliases = []) {
  return (items) => discoverTitles(items, books, aliases);
}
const allItems = () => [
  ...parseCatalog("phoenix", page1),
  ...parseCatalog("phoenix", page2),
];

test("discovery groups volumes and special editions, prefers a regular volume 1, and retains one-shots", () => {
  const titles = discovery()(allItems());
  assert.equal(titles.length, 2);
  const first = titles.find((item) => item.volume === 1);
  assert.equal(first.special, false);
  assert.equal(first.coverUrl, image("yuri-1"));
  const fallback = discovery()(parseCatalog("phoenix", page1));
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].volume, 1);
  assert.equal(fallback[0].special, true);
  assert.equal(discovery()([allItems()[0]])[0].volume, 3);
});

test("any owned volume hides a discovered title, including publisher aliases, another format, linked names and exact ISBNs", () => {
  const book = {
    series: "เรื่องใหม่",
    publisher: "PHOENIX Next",
    type: "LN (TH)",
    volume: 9,
    isbn: "",
  };
  assert.equal(discovery([book])(allItems()).length, 1);
  assert.equal(
    discovery([{ ...book, publisher: "Other publisher" }])(allItems()).length,
    2,
  );
  assert.equal(
    discovery(
      [{ ...book, series: "My translated name" }],
      [
        {
          series: "My translated name",
          title: "เรื่องใหม่",
          publisherId: "phoenix",
        },
      ],
    )(allItems()).length,
    1,
  );
  const withIsbn = allItems();
  withIsbn[0].isbn = "0140328726";
  assert.equal(
    discovery([{ ...book, series: "Unrelated alias", isbn: "9780140328721" }])(
      withIsbn,
    ).length,
    1,
  );
  assert.equal(
    discovery([])(allItems()).length,
    2,
    "Removed/saved titles do not count as ownership",
  );
});

test("publisher category pagination reads the total, pairs covers with their own titles and caches across restart", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "books-discovery-")),
    "books.sqlite",
  );
  let store = openStore(path),
    calls = [];
  const service = createCatalogService(store, async (requested) => {
    calls.push(requested);
    return new Response(requested.endsWith("?p=2") ? page2 : page1);
  });
  const feed = await service.getPublisherCatalog({ url });
  assert.equal(feed.complete, true);
  assert.equal(feed.total, 4);
  assert.equal(feed.pages, 2);
  assert.equal(feed.items[0].coverUrl, image("yuri-3"));
  assert.equal(catalogTotal("phoenix", page1), 4);
  await service.getPublisherCatalog({ url });
  assert.equal(calls.length, 2);
  store.close();
  store = openStore(path);
  try {
    const restarted = createCatalogService(store, async () => {
      throw new Error("Test outage");
    });
    const cached = await restarted.getPublisherCatalog({ url });
    assert.equal(cached.checkedAt, feed.checkedAt);
    const stale = await restarted.getPublisherCatalog({ url, refresh: true });
    assert.equal(stale.stale, true);
    assert.equal(stale.checkedAt, feed.checkedAt);
    assert.equal(stale.items.length, 3);
  } finally {
    store.close();
  }
});

test("a repeated or failed later page stays incomplete, and incomplete refreshes retain a previous complete catalog", async () => {
  const store = openStore(":memory:");
  try {
    let fail = false;
    const service = createCatalogService(store, async (requested) => {
      if (requested.endsWith("?p=2"))
        return new Response(fail ? "Down" : page2, {
          status: fail ? 503 : 200,
        });
      return new Response(page1);
    });
    const fresh = await service.getPublisherCatalog({ url });
    fail = true;
    const stale = await service.getPublisherCatalog({ url, refresh: true });
    assert.equal(stale.stale, true);
    assert.equal(stale.checkedAt, fresh.checkedAt);
    const partial = await service.getPublisherCatalog({
      url: "https://www.phoenixnext.com/bl.html",
    });
    assert.equal(partial.complete, false);
    assert.equal(partial.items.length, 1);
    assert.match(partial.error, /missing titles/);
    const repeated = await createCatalogService(
      store,
      async () => new Response(page1),
    ).getPublisherCatalog({ url: "https://www.phoenixnext.com/manga.html" });
    assert.equal(repeated.complete, false);
    assert.equal(repeated.pages, 2);
  } finally {
    store.close();
  }
});

test("category and cover URL validation reject arbitrary fetches and unsafe image URLs", () => {
  for (const unsafe of [
    "https://evil.test/gl.html",
    "http://www.phoenixnext.com/gl.html",
    "https://www.phoenixnext.com.evil.test/gl.html",
    url + "?p=2",
    "https://www.phoenixnext.com/customer/account.html",
  ])
    assert.throws(() => publisherCatalogSource(unsafe), /category/);
  assert.equal(
    publisherCatalogSource("https://www.firstpagepro.com/category/56/manga")
      .url,
    "https://www.firstpagepro.com/category/56",
  );
  for (const unsafe of [
    "javascript:alert(1)",
    "data:image/svg+xml,foo",
    "https://evil.test/a.jpg",
    "https://www.phoenixnext.com:444/a.jpg",
    "https://user:password@www.phoenixnext.com/a.jpg",
  ])
    assert.equal(safeCoverUrl(unsafe), "");
  assert.equal(
    safeCoverUrl("/media/cover.jpg", url),
    "https://www.phoenixnext.com/media/cover.jpg",
  );
  const first = parseCatalog(
    "firstpage",
    '<div class="productArea productItem"><a class="gadgetThumbnail" href="https://www.firstpagepro.com/product/1/name" title="การ์ตูน เรื่องหนึ่ง เล่ม 1"><img src="https://www.firstpagepro.com/images/blank.gif" data-src="https://cj.lnwfile.com/a.jpg"></a></div>',
  );
  assert.equal(first[0].coverUrl, "https://cj.lnwfile.com/a.jpg");
});

test("covers survive saved releases and Luckpim uses the verified thumbnail layout", () => {
  const item = allItems()[2];
  assert.equal(cleanRelease(item).coverUrl, item.coverUrl);
  assert.equal(
    luckpimItem({
      slug: "2847",
      title: "เรื่องหนึ่ง 05",
      thumbnail_gen: "lrsjutokmc9",
      thumbnail: "cover.jpg",
    }).coverUrl,
    "https://www.luckpim.com/stocks/product/d284x400/ut/ok/lrsjutokmc9/cover.webp",
  );
});

test("owned covers use matching catalog volumes before ISBN lookup, and ISBN covers never accept another edition", async () => {
  const store = openStore(":memory:");
  try {
    store.api.saveBook({
      book: {
        series: "เรื่องใหม่",
        publisher: "PHOENIX Next",
        type: "Manga (TH)",
        status: "Read",
        volume: 1,
      },
      requestId: "cover-volume-test",
    });
    const row = store.api.getCollection().books[0].row;
    const service = createCatalogService(
      store,
      async (requested) =>
        new Response(requested.endsWith("?p=2") ? page2 : page1),
    );
    await service.getPublisherCatalog({ url });
    assert.equal(
      (await service.getBookCover({ row })).coverUrl,
      image("yuri-1"),
    );
    store.api.saveBook({
      book: {
        series: "Matilda",
        publisher: "Publisher",
        type: "LN (EN)",
        status: "Read",
        isbn: "0140328726",
      },
      requestId: "cover-isbn-test",
    });
    const isbnRow = store.api.getCollection().books[1].row;
    let calls = 0;
    const lookup = createCatalogService(store, async (requested) => {
      calls++;
      if (requested.includes("naiin"))
        return new Response('<product-list :items="[]">');
      if (requested.includes("yaakz"))
        return new Response('{"data":[],"total":0}');
      if (requested.startsWith("https://kinokuniya.co.th/products/"))
        return new Response("Not found", { status: 404 });
      if (requested === "https://yenpress.com/search")
        return new Response(
          readFileSync(
            new URL(
              "../fixtures/publishers/yenpress-search.html",
              import.meta.url,
            ),
            "utf8",
          ),
        );
      if (requested.includes("enterprise-search.yenpress.com"))
        return new Response('{"results":[]}');
      return new Response(
        JSON.stringify({
          items: [
            {
              volumeInfo: {
                title: "Wrong edition",
                industryIdentifiers: [{ identifier: "9786166247275" }],
                imageLinks: { thumbnail: image("wrong") },
              },
            },
            {
              volumeInfo: {
                title: "Matilda",
                industryIdentifiers: [{ identifier: "9780140328721" }],
                imageLinks: { thumbnail: "https://books.google.com/cover.jpg" },
              },
            },
          ],
        }),
      );
    });
    const covers = await Promise.all([
      lookup.getBookCover({ row: isbnRow }),
      lookup.getBookCover({ row: isbnRow }),
    ]);
    assert.equal(covers[0].coverUrl, "https://books.google.com/cover.jpg");
    assert.equal(covers[1].coverUrl, covers[0].coverUrl);
    assert.equal(calls, 10);
    await lookup.getBookCover({ row: isbnRow });
    assert.equal(calls, 10);
    await assert.rejects(lookup.getBookCover({ row: 999 }), /no longer/);
  } finally {
    store.close();
  }
});

test("navigation supplies the title directory, excludes parents and keeps First Page formats separate", () => {
  const html =
    '<a href="https://www.phoenixnext.com/book-series/one.html">เรื่องหนึ่ง</a>' +
    '<a href="https://www.phoenixnext.com/gl/one.html">เรื่องหนึ่ง (4) รายการ</a>' +
    '<a href="https://www.phoenixnext.com/gl/one.html">เรื่องหนึ่ง</a>' +
    '<a href="https://www.phoenixnext.com/gl/two.html">เรื่องสอง (1) ชิ้น</a>';
  const titles = parsePublisherTitles("phoenix", html, url);
  assert.equal(titles.length, 2);
  assert.equal(titles[0].categories.length, 1);
  assert.ok(titles.every((item) => !/รายการ|ชิ้น/.test(item.series)));
  assert.equal(
    parsePublisherTitles(
      "phoenix",
      html,
      "https://www.phoenixnext.com/book-series.html",
    ).length,
    1,
  );
  const firstpage =
    '<a href="https://www.firstpagepro.com/category/1/light-novel-books">Light Novel [20]</a>' +
    '<a href="https://www.firstpagepro.com/category/8/light-novel-books/one">เรื่องหนึ่ง [10]</a>' +
    '<a href="https://www.firstpagepro.com/category/2/manga-books">Manga [20]</a>' +
    '<a href="https://www.firstpagepro.com/category/9/manga-books/one">เรื่องหนึ่ง [5]</a>';
  const first = parsePublisherTitles(
    "firstpage",
    firstpage,
    "https://www.firstpagepro.com/",
  );
  assert.equal(first.length, 2);
  assert.ok(
    first.every(
      (item) => item.categories.length === 1 && item.series === "เรื่องหนึ่ง",
    ),
  );
  assert.deepEqual(first.map((item) => item.type).sort(), [
    "LN (TH)",
    "Manga (TH)",
  ]);
  assert.notEqual(first[0].id, first[1].id);
});

test("First Page manga rating directories contain only titles from the selected rating and cache separately", async () => {
  const html = readFileSync(
    new URL(
      "../fixtures/series-catalogs/firstpage-directory.html",
      import.meta.url,
    ),
    "utf8",
  );
  const store = openStore(":memory:"),
    calls = [],
    seen = new Set();
  const service = createCatalogService(store, async (requested) => {
    calls.push(requested);
    return new Response(html);
  });
  try {
    for (const [id, count, sample] of [
      [22, 54, "https://www.firstpagepro.com/category/126"],
      [7, 28, "https://www.firstpagepro.com/category/133"],
      [63, 21, "https://www.firstpagepro.com/category/79"],
    ]) {
      const url = "https://www.firstpagepro.com/category/" + id;
      const directory = await service.getPublisherDirectory({ url });
      assert.equal(directory.stale, false);
      assert.equal(directory.url, url);
      assert.equal(directory.titles.length, count);
      assert.ok(directory.titles.every((title) => title.type === "Manga (TH)"));
      const categories = directory.titles.flatMap((title) => title.categories);
      assert.ok(categories.some((category) => category.url === sample));
      for (const category of categories) {
        assert.ok(
          !seen.has(category.url),
          "Ratings must not leak other categories",
        );
        assert.notEqual(category.url, url, "The rating itself is not a title");
        seen.add(category.url);
      }
      const cached = await service.getPublisherDirectory({ url });
      assert.deepEqual(cached, directory);
    }
    assert.deepEqual(
      calls,
      [22, 7, 63].map((id) => "https://www.firstpagepro.com/category/" + id),
    );
  } finally {
    store.close();
  }
});

test("directory loading needs one navigation request, lazily resolves first volumes, and preserves stale directories", async () => {
  const store = openStore(":memory:"),
    calls = [];
  const category = "https://www.phoenixnext.com/gl/new-title.html";
  let fail = false;
  const service = createCatalogService(store, async (requested) => {
    calls.push(requested);
    if (fail) throw new Error("Test outage");
    if (requested === url)
      return new Response(`<a href="${category}">เรื่องใหม่ (4) รายการ</a>`);
    return new Response(requested.endsWith("?p=2") ? page2 : page1);
  });
  try {
    const directory = await service.getPublisherDirectory({ url });
    assert.equal(directory.titles.length, 1);
    assert.equal(calls.length, 1);
    const result = await service.getPublisherTitle({
      publisherId: "phoenix",
      categories: directory.titles[0].categories,
    });
    assert.equal(result.item.volume, 1);
    assert.equal(result.item.special, false);
    assert.equal(result.item.coverUrl, image("yuri-1"));
    assert.equal(calls.length, 3);
    await service.getPublisherTitle({
      publisherId: "phoenix",
      categories: directory.titles[0].categories,
    });
    assert.equal(calls.length, 3);
    fail = true;
    const stale = await service.getPublisherDirectory({ url, refresh: true });
    assert.equal(stale.stale, true);
    assert.equal(stale.checkedAt, directory.checkedAt);
    assert.equal(stale.titles.length, 1);
    await assert.rejects(
      service.getPublisherTitle({
        publisherId: "phoenix",
        categories: [{ url: "https://evil.test/a" }],
      }),
      /category/,
    );
  } finally {
    store.close();
  }
});

test("Phoenix categories with an explicit empty message are complete empty catalogs and can later list a book", async () => {
  const html = readFileSync(
    new URL(
      "../fixtures/series-catalogs/phoenix-empty-category.html",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(catalogTotal("phoenix", html), 0);
  assert.equal(catalogTotal("firstpage", html), null);
  assert.equal(
    catalogTotal("phoenix", '<div class="empty info message extra"></div>'),
    0,
  );
  assert.equal(
    catalogTotal("phoenix", '<div class="message info"></div>'),
    null,
  );
  const store = openStore(":memory:");
  const category =
    "https://www.phoenixnext.com/gl/the-story-of-unforgettable-witch.html";
  let body = html,
    calls = 0;
  const service = createCatalogService(store, async () => {
    calls++;
    return new Response(body);
  });
  try {
    const catalog = await service.getPublisherCatalog({ url: category });
    assert.deepEqual(catalog.items, []);
    assert.equal(catalog.total, 0);
    assert.equal(catalog.complete, true);
    assert.equal(catalog.stale, false);
    assert.equal(catalog.error, "");
    assert.equal(catalog.pages, 1);
    const request = {
      publisherId: "phoenix",
      categories: [{ url: category }],
    };
    const empty = await service.getPublisherTitle(request);
    assert.equal(empty.item, null);
    assert.equal(empty.complete, true);
    assert.equal(empty.stale, false);
    assert.equal(calls, 1);
    body =
      '<span class="toolbar-number">1</span>' +
      card("witch", "(มังงะ) เรื่องแม่มด");
    const released = await service.getPublisherTitle({
      ...request,
      refresh: true,
    });
    assert.equal(released.item.series, "เรื่องแม่มด");
    assert.equal(released.item.volume, "");
    assert.equal(released.complete, true);
    assert.equal(released.stale, false);
    assert.equal(calls, 2);
  } finally {
    store.close();
  }
});

test("First Page categories with cover artwork but zero products are confirmed empty and can later list a book", async (t) => {
  const html = readFileSync(
    new URL(
      "../fixtures/series-catalogs/firstpage-empty-category.html",
      import.meta.url,
    ),
    "utf8",
  );
  const store = openStore(":memory:");
  t.after(() => store.close());
  const category = "https://www.firstpagepro.com/category/154";
  let body = html;
  const service = createCatalogService(store, async () => new Response(body));
  const request = {
    publisherId: "firstpage",
    categories: [{ url: category, type: "Manga (TH)" }],
  };
  const empty = await service.getPublisherTitle(request);
  assert.equal(empty.item, null);
  assert.equal(empty.complete, true);
  assert.equal(empty.stale, false);
  assert.equal(empty.error, "");
  body =
    '<span class="tsk-all">1</span><div class="productArea productItem"><a class="gadgetThumbnail" href="https://www.firstpagepro.com/product/1" title="การ์ตูน 16 ปี แค่ได้คิดถึงเธอ มันก็ช่างใหญ่เกินใจ"><img data-src="https://cj.lnwfile.com/cover.jpg"></a></div>';
  const released = await service.getPublisherTitle({
    ...request,
    refresh: true,
  });
  assert.equal(
    released.item.series,
    "16 ปี แค่ได้คิดถึงเธอ มันก็ช่างใหญ่เกินใจ",
  );
  assert.equal(released.item.volume, "");
  assert.equal(released.complete, true);
  assert.equal(released.stale, false);
});

test("unrecognized publisher markup and outages do not confirm an empty series", async () => {
  for (const [publisherId, url] of [
    ["phoenix", "https://www.phoenixnext.com/gl/unavailable.html"],
    ["firstpage", "https://www.firstpagepro.com/category/154"],
  ])
    for (const [body, status] of [
      ['<div class="message info">Unknown category markup</div>', 200],
      ["Publisher unavailable", 503],
    ]) {
      const store = openStore(":memory:");
      try {
        const service = createCatalogService(
          store,
          async () => new Response(body, { status }),
        );
        const result = await service.getPublisherTitle({
          publisherId,
          categories: [{ url }],
        });
        assert.equal(result.item, null);
        assert.equal(result.complete, false);
        assert.equal(result.stale, true);
        assert.ok(result.error);
      } finally {
        store.close();
      }
    }
});

test("First Page follows only same-category redirects and decodes raw UTF-8 Thai Location headers", async () => {
  const store = openStore(":memory:"),
    calls = [];
  const target =
    "https://www.firstpagepro.com/category/56/manga-books/เรื่องหนึ่ง";
  const html =
    '<span class="tsk-all">1</span><div class="productArea productItem"><a class="gadgetThumbnail" href="https://www.firstpagepro.com/product/1" title="การ์ตูน เรื่องหนึ่ง เล่ม 1"><img data-src="https://cj.lnwfile.com/cover.jpg"></a></div>';
  try {
    const service = createCatalogService(store, async (requested) => {
      calls.push(requested);
      if (requested === "https://www.firstpagepro.com/category/56")
        return new Response("", {
          status: 301,
          headers: { Location: Buffer.from(target, "utf8").toString("latin1") },
        });
      assert.equal(requested, new URL(target).href);
      return new Response(html);
    });
    const result = await service.getPublisherTitle({
      publisherId: "firstpage",
      categories: [{ url: "https://www.firstpagepro.com/category/56" }],
    });
    assert.equal(result.item.volume, 1);
    assert.equal(result.item.coverUrl, "https://cj.lnwfile.com/cover.jpg");
    assert.equal(result.complete, true);
    assert.equal(calls.length, 2);
    for (const [index, target] of [
      "https://evil.test/category/56",
      "http://www.firstpagepro.com/category/56/title",
      "https://www.firstpagepro.com/category/99/title",
    ].entries()) {
      let count = 0;
      const service = createCatalogService(store, async () => {
        count++;
        return new Response("", { status: 302, headers: { Location: target } });
      });
      const result = await service.getPublisherCatalog({
        url: "https://www.firstpagepro.com/category/" + (12 + index),
      });
      assert.equal(result.stale, true);
      assert.equal(count, 1);
    }
  } finally {
    store.close();
  }
});
