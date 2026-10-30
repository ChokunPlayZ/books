import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../lib/server/store.ts";
import { parseImport } from "../../lib/server/importer.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { publisherCovers } from "../../lib/server/publisher-covers.ts";
import { specialSet } from "../../lib/domain.ts";

const book = {
  series: "Cover story",
  publisher: "PHOENIX Next",
  type: "Manga (TH)",
  status: "Read",
  volume: 1,
  isbn: "",
  price: "",
  date: "",
  source: "",
  note: "",
};
const product = "https://www.phoenixnext.com/story-01.html";
const category = "https://www.phoenixnext.com/book-series/story.html";
const image = (name) =>
  "https://www.phoenixnext.com/media/catalog/product/" + name + ".jpg";
let sequence = 0;
const save = (store, data, previous) =>
  store.api.saveBook({
    requestId: "metadata_test_" + ++sequence,
    book: data,
    ...(previous ? { row: previous.row, token: previous.token } : {}),
  });

test("volume metadata survives restart, edits, trash, restore and JSON backup import", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "books-metadata-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "books.sqlite");
  let store = openStore(path);
  save(store, {
    ...book,
    coverUrl: image("chosen"),
    publisherUrl: product,
    pageCount: 208,
  });
  store.close();
  store = openStore(path);
  try {
    let volume = store.api.getCollection().books[0];
    assert.equal(volume.coverUrl, image("chosen"));
    assert.equal(volume.publisherUrl, product);
    assert.equal(volume.pageCount, 208);
    const service = createCatalogService(store, () =>
      assert.fail("Manual covers must not use the network"),
    );
    assert.equal(
      (await service.getBookCover({ row: volume.row })).coverUrl,
      image("chosen"),
    );
    save(store, { ...book, note: "ordinary edit" }, volume);
    assert.throws(
      () => save(store, { ...book, coverUrl: image("stale") }, volume),
      { status: 409 },
    );
    volume = store.api.getCollection().books[0];
    assert.equal(volume.coverUrl, image("chosen"));
    assert.equal(
      volume.pageCount,
      208,
      "Edits from older clients preserve pages",
    );
    const removed = store.api.removeBook({
      row: volume.row,
      token: volume.token,
      requestId: "metadata_remove_1",
    });
    const backup = store.exportData();
    assert.equal(backup.trash[0].book.coverUrl, image("chosen"));
    assert.equal(backup.trash[0].book.pageCount, 208);
    const restored = openStore(":memory:");
    try {
      const plan = parseImport(
        Buffer.from(JSON.stringify(backup)),
        "backup.json",
      );
      restored.importData(plan, plan.fingerprint);
      const entry = restored.api.getCollection().trash[0];
      restored.api.restoreBook({
        trashId: entry.id,
        requestId: "metadata_restore_1",
      });
      assert.equal(restored.api.getCollection().books[0].publisherUrl, product);
      assert.equal(restored.api.getCollection().books[0].pageCount, 208);
      assert.equal(
        restored.api.getCollection().books[0].coverUrl,
        image("chosen"),
      );
    } finally {
      restored.close();
    }
    store.api.restoreBook({
      trashId: removed.trashId,
      requestId: "metadata_restore_2",
    });
    volume = store.api.getCollection().books[0];
    save(
      store,
      { ...book, coverUrl: "", publisherUrl: "", pageCount: "" },
      volume,
    );
    assert.equal(store.api.getCollection().books[0].coverUrl, "");
    assert.equal(store.api.getCollection().books[0].pageCount, "");
  } finally {
    store.close();
  }
});

test("version 1 databases migrate without losing books and invalid metadata rolls back", () => {
  const directory = mkdtempSync(join(tmpdir(), "books-migration-"));
  const path = join(directory, "books.sqlite");
  let store = openStore(path);
  save(store, book);
  store.db.exec(
    "ALTER TABLE books DROP COLUMN page_count; ALTER TABLE books DROP COLUMN cover_id; DROP TABLE cover_sources; DROP TABLE covers; ALTER TABLE books DROP COLUMN cover_url; ALTER TABLE books DROP COLUMN publisher_url; PRAGMA user_version=1;",
  );
  store.close();
  store = openStore(path);
  try {
    assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 4);
    const volume = store.api.getCollection().books[0];
    assert.equal(volume.series, book.series);
    assert.equal(volume.coverUrl, "");
    assert.equal(volume.pageCount, "");
    for (const data of [
      { coverUrl: "https://evil.test/cover.jpg" },
      { publisherUrl: "javascript:alert(1)" },
      { publisherUrl: "https://www.phoenixnext.com.evil.test/book.html" },
      { publisherUrl: "https://www.firstpagepro.com/product/1" },
      { pageCount: -1 },
      { pageCount: 0 },
      { pageCount: 1.5 },
      { pageCount: "many" },
      { pageCount: true },
      { pageCount: [] },
      { pageCount: Number.MAX_SAFE_INTEGER + 1 },
    ])
      assert.throws(() => save(store, { ...book, ...data }, volume));
    assert.equal(store.api.getCollection().books[0].token, volume.token);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publisher galleries include all product images and exclude unrelated recommendation images", () => {
  const phoenix = `<script>initialImages: ${JSON.stringify([
    { full: image("front"), img: image("thumbnail"), type: "image" },
    { full: image("alternate"), type: "image" },
    { full: "https://evil.test/tracker.jpg", type: "image" },
    { full: image("video"), type: "video" },
  ])}</script><img src="${image("recommendation")}"><meta property="og:image" content="${image("thumbnail")}">`;
  assert.deepEqual(publisherCovers(phoenix, product), [
    image("front"),
    image("alternate"),
  ]);
  const raw = "https://cj.lnwfile.com/_/cj/_raw/front.jpg";
  assert.deepEqual(
    publisherCovers(
      `<img class="productImage" src="${raw}"><img class="thumb" src="small.jpg" data-src="${raw}"><img class="thumb" data-src="https://cj.lnwfile.com/alternate.jpg"><img src="https://cj.lnwfile.com/recommendation.jpg">`,
      "https://www.firstpagepro.com/product/1",
    ),
    [raw, "https://cj.lnwfile.com/alternate.jpg"],
  );
  assert.deepEqual(
    publisherCovers(
      '<img class=gallery-img src=https://www.luckpim.com/stocks/front.webp><img class=gallery-img src=https://www.luckpim.com/stocks/back.webp><img class="img img-lazy" data-src=https://www.luckpim.com/stocks/unrelated.webp>',
      "https://www.luckpim.com/product/detail/1",
    ),
    [
      "https://www.luckpim.com/stocks/front.webp",
      "https://www.luckpim.com/stocks/back.webp",
    ],
  );
});

test("cover lookup matches the volume and format, pulls alternate editions and skips special sets", async () => {
  const store = openStore(":memory:");
  try {
    save(store, book);
    store.api.setSeriesCatalog({
      series: book.series,
      type: book.type,
      publisherId: "phoenix",
      url: category,
    });
    const calls = [];
    const titles = [
      "Cover story เล่ม 1 (Mg)",
      "Cover story เล่ม 2 (Mg)",
      "Special Set Cover story เล่ม 1 (Mg)",
      "Cover story เล่ม 1 (LN)",
      "Limited Edition Cover story เล่ม 1 (Mg)",
    ];
    const urls = [
      product,
      product.replace("01", "02"),
      product.replace("01", "set"),
      product.replace("01", "novel"),
      product.replace("01", "alternate"),
    ];
    const html =
      '<span class="toolbar-number">5</span>' +
      titles
        .map(
          (title, i) =>
            `<a class="product-item-link" href="${urls[i]}">${title}</a>`,
        )
        .join("");
    const service = createCatalogService(store, async (url) => {
      calls.push(url);
      if (url === category) return new Response(html);
      return new Response(
        `<h1>Cover story เล่ม 1</h1><script>initialImages: ${JSON.stringify([{ full: image(url === product ? "regular" : "limited"), type: "image" }])}</script>`,
      );
    });
    const result = await service.getBookCoverOptions({
      row: store.api.getCollection().books[0].row,
    });
    assert.deepEqual(result.covers.map((item) => item.coverUrl).sort(), [
      image("limited"),
      image("regular"),
    ]);
    assert.ok(
      !calls.includes(urls[1]) &&
        !calls.includes(urls[2]) &&
        !calls.includes(urls[3]),
    );
    const before = calls.length;
    const reused = await service.getBookCoverOptions({ row: result.row });
    assert.deepEqual(reused.covers, result.covers);
    assert.equal(
      calls.length,
      before,
      "Reopening the picker reuses catalog and gallery pages",
    );
    await assert.rejects(
      service.getBookCoverOptions({
        row: result.row,
        publisherUrl: "https://evil.test/private",
      }),
      /publisher/,
    );
    assert.equal(calls.length, before);
  } finally {
    store.close();
  }
});

test("cover lookup includes Phoenix revised editions without a product link and excludes unrelated catalog variants", async (t) => {
  const series = "ดอกรักผลิบานที่กลางใจ";
  const revisedUrl = "https://www.phoenixnext.com/mg0435-02.html";
  const revisedCover =
    "https://www.phoenixnext.com/media/catalog/product/cache/616a7398005cfee60500354f848a3838/_/m/_m_kaoru_hana_vol1_jacket_cover_1.jpg";
  const gallery = readFileSync(
    new URL(
      "../fixtures/publishers/phoenix-revised-volume.html",
      import.meta.url,
    ),
    "utf8",
  );
  const entries = [
    [revisedUrl, `(มังงะ) ${series} (ฉบับปรับปรุงใหม่) เล่ม 1`],
    [product.replace("01", "02"), `(มังงะ) ${series} เล่ม 2`],
    [product.replace("01", "novel"), `(LN) ${series} เล่ม 1`],
    [product.replace("01", "set"), `Special Set (มังงะ) ${series} เล่ม 1`],
    [product.replace("01", "spinoff"), `(มังงะ) ${series} ภาคพิเศษ เล่ม 1`],
    [product.replace("01", "other"), "(มังงะ) เรื่องอื่น เล่ม 1"],
  ];
  const categoryHtml =
    `<h1>${series}</h1><span class="toolbar-number">${entries.length}</span>` +
    entries
      .map(
        ([url, title]) =>
          `<a class="product-item-link" href="${url}">${title}</a>`,
      )
      .join("");
  for (const libraryTitle of [
    series,
    "The Fragrant Flower Blooms With Dignity",
  ])
    await t.test(libraryTitle, async () => {
      const store = openStore(":memory:");
      try {
        save(store, { ...book, series: libraryTitle });
        store.api.setSeriesCatalog({
          series: libraryTitle,
          type: book.type,
          publisherId: "phoenix",
          url: category,
          title: series,
        });
        const calls = [];
        const service = createCatalogService(store, async (url) => {
          calls.push(url);
          if (url === category) return new Response(categoryHtml);
          if (url === revisedUrl) return new Response(gallery);
          return new Response("", { status: 503 });
        });
        const result = await service.getBookCoverOptions({ row: 1 });
        assert.deepEqual(
          result.covers.map((cover) => cover.coverUrl),
          [revisedCover],
        );
        assert.equal(result.covers[0].publisherUrl, revisedUrl);
        assert.ok(calls.includes(revisedUrl));
        assert.ok(entries.slice(1).every(([url]) => !calls.includes(url)));
        assert.equal(store.api.getCollection().books[0].series, libraryTitle);
      } finally {
        store.close();
      }
    });
});

test("special set exclusion recognizes English and Thai without excluding special editions", () => {
  for (const title of [
    "Special Set Story",
    "SPECIAL-SET Story",
    "Special Combo Set Story",
    "เรื่อง เซตพิเศษ",
    "เรื่อง ชุดพิเศษ",
    "เรื่อง เซ็ทพิเศษ",
  ])
    assert.equal(specialSet(title), true, title);
  for (const title of [
    "Special Edition Story",
    "Limited Edition Story",
    "Special Setting Story",
    "Story เล่ม 1",
  ])
    assert.equal(specialSet(title), false, title);
});

test("manual covers belong to one copy and clearing a choice returns to automatic lookup", async () => {
  const store = openStore(":memory:");
  try {
    save(store, { ...book, coverUrl: image("my-copy"), publisherUrl: product });
    save(store, book);
    const [selected, other] = store.api.getCollection().books;
    const service = createCatalogService(store, () =>
      assert.fail("Unindexed copies do not need an ISBN lookup"),
    );
    assert.equal(
      (await service.getBookCover({ row: selected.row })).coverUrl,
      image("my-copy"),
    );
    assert.equal((await service.getBookCover({ row: other.row })).coverUrl, "");
    save(store, { ...book, coverUrl: "" }, selected);
    assert.equal(
      (await service.getBookCover({ row: selected.row })).coverUrl,
      "",
    );
    save(store, {
      ...book,
      publisher: "Other Publisher",
      publisherUrl: "https://publisher.example/books/1",
    });
    assert.equal(
      store.api.getCollection().books[2].publisherUrl,
      "https://publisher.example/books/1",
    );
  } finally {
    store.close();
  }
});
