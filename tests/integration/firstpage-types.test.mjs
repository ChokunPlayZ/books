import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import {
  parseCatalog,
  parsePublisherTitles,
  releaseItem,
  digest,
  splitFirstPageTitle,
} from "../../lib/domain.ts";
import { discoverTitles } from "../../lib/client/matching.ts";
import { createScrapeCache } from "../../lib/server/scrape-cache.ts";

const fixture = readFileSync(
  new URL("../fixtures/publishers/firstpage-formats.html", import.meta.url),
  "utf8",
);
const directory =
  '<a href="https://www.firstpagepro.com/category/1/light-novel-books">Light Novel</a><a href="https://www.firstpagepro.com/category/8/light-novel-books/shared">เรื่องเดียวกัน</a><a href="https://www.firstpagepro.com/category/2/manga-books">Manga</a><a href="https://www.firstpagepro.com/category/9/manga-books/shared">เรื่องเดียวกัน</a>';
const noNetwork = async () => {
  throw new Error("Cached records must not need a fetch");
};

test("First Page product labels distinguish actual novels and manga and override stale type hints", () => {
  const items = parseCatalog("firstpage", fixture);
  assert.deepEqual(
    items.map((item) => item.type),
    ["Manga (TH)", "LN (TH)"],
  );
  assert.equal(
    releaseItem(
      "firstpage",
      items[1].title,
      items[1].url,
      100,
      "",
      "Manga (TH)",
    ).type,
    "LN (TH)",
  );
  assert.equal(
    releaseItem("firstpage", items[0].title, items[0].url, 100, "", "LN (TH)")
      .type,
    "Manga (TH)",
  );
  for (const prefix of [
    "[PRE-ORDER] ",
    "LIMITED SET ",
    "LIMITED SET A ",
    "[PRE-ORDER] LIMITED SET B ",
    "Special Edition ",
  ]) {
    assert.deepEqual(splitFirstPageTitle(prefix + "นิยาย เรื่องหนึ่ง เล่ม 2"), {
      series: "เรื่องหนึ่ง",
      volume: 2,
      type: "LN (TH)",
    });
    assert.equal(
      splitFirstPageTitle(prefix + "การ์ตูน เรื่องหนึ่ง เล่ม 2").type,
      "Manga (TH)",
    );
  }
  assert.equal(
    splitFirstPageTitle("การ์ตูน ชีวิตใน Light Novel เล่ม 1").type,
    "Manga (TH)",
  );
  assert.equal(
    splitFirstPageTitle("นิยาย ชีวิตในการ์ตูน เล่ม 1").type,
    "LN (TH)",
  );
  assert.equal(splitFirstPageTitle("เรื่องไม่มีข้อมูลรูปแบบ เล่ม 1").type, "");
});

test("First Page discovery retains both formats and an owned manga does not hide its novel", () => {
  const titles = parsePublisherTitles(
    "firstpage",
    directory,
    "https://www.firstpagepro.com/",
  );
  assert.equal(titles.length, 2);
  assert.deepEqual(titles.map((item) => item.type).sort(), [
    "LN (TH)",
    "Manga (TH)",
  ]);
  const owned = {
    series: "เรื่องเดียวกัน",
    publisher: "First Page Pro",
    type: "Manga (TH)",
    volume: 1,
    isbn: "",
  };
  assert.deepEqual(
    discoverTitles(titles, [owned]).map((item) => item.type),
    ["LN (TH)"],
  );
  assert.deepEqual(
    discoverTitles(titles, [{ ...owned, type: "LN (TH)" }]).map(
      (item) => item.type,
    ),
    ["Manga (TH)"],
  );
  assert.equal(discoverTitles(titles, []).length, 2);
});

test("old merged directories and incorrect cached releases/ISBN results are corrected without a network request", async () => {
  const store = openStore(":memory:");
  try {
    const items = parseCatalog("firstpage", fixture);
    const incorrect = {
      ...items[1],
      type: "Manga (TH)",
      coverId: "existing-cover",
    };
    store.cache.put(
      "releases:v1:firstpage",
      JSON.stringify({
        publisherId: "firstpage",
        items: [incorrect],
        checkedAt: new Date().toISOString(),
      }),
      3600,
    );
    const titles = parsePublisherTitles(
      "firstpage",
      directory,
      "https://www.firstpagepro.com/",
    );
    store.cache.put(
      "publisher-directory:v1:" + digest("https://www.firstpagepro.com/"),
      JSON.stringify({
        publisherId: "firstpage",
        url: "https://www.firstpagepro.com/",
        checkedAt: new Date().toISOString(),
        titles: [
          {
            ...titles[0],
            type: "",
            categories: titles.flatMap((title) => title.categories),
          },
        ],
      }),
      3600,
    );
    const isbn = "9780140328721";
    await createScrapeCache(store.cache).get(
      "publisher-isbn:v2:firstpage:" + isbn,
      { maxAge: 86400 },
      async () => ({
        publisherId: "firstpage",
        isbn,
        items: [incorrect],
        warnings: [],
      }),
    );
    const api = createCatalogService(store, noNetwork);
    assert.equal(
      (await api.getPublisherReleases({ publisherId: "firstpage" })).items[0]
        .type,
      "LN (TH)",
    );
    const correctedDirectory = await api.getPublisherDirectory({
      url: "https://www.firstpagepro.com/",
    });
    assert.deepEqual(
      correctedDirectory.titles.map((title) => title.type).sort(),
      ["LN (TH)", "Manga (TH)"],
    );
    const result = await api.searchPublisherIsbn({
      publisherId: "firstpage",
      isbn,
    });
    assert.equal(result.items[0].type, "LN (TH)");
    assert.equal(result.items[0].coverId, "existing-cover");
    store.api.setSavedRelease({ release: items[1], saved: true });
    store.db
      .prepare("UPDATE saved_releases SET data=? WHERE id=?")
      .run(JSON.stringify(incorrect), incorrect.id);
    assert.equal(store.api.getCollection().savedReleases[0].type, "LN (TH)");
    assert.equal(
      store.api.getCollection().savedReleases[0].coverId,
      "existing-cover",
    );
  } finally {
    store.close();
  }
});
