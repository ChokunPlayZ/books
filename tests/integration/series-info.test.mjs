import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openTestStore } from "../helpers/database.mjs";
import { createSeriesInfoService } from "../../lib/server/series-info.ts";
import { parseAnimeMedia } from "../../lib/domain/anime.ts";
import { parseImport } from "../../lib/server/importer.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";

const media = parseAnimeMedia({
  id: 42,
  type: "MANGA",
  format: "MANGA",
  title: {
    english: "Moon Library",
    native: "月の図書館",
    romaji: "Tsuki no Toshokan",
  },
  description: "The English series synopsis.",
});
async function add(store, series, edition = "(EN)", type = "Manga", isbn = "") {
  return store.api.saveBook({
    requestId: randomUUID(),
    book: {
      series,
      type,
      edition,
      isbn,
      publisher: "",
      volume: 1,
      status: "Read",
      price: "",
      date: "",
      source: "",
      note: "",
      coverUrl: "",
      publisherUrl: "",
    },
  });
}
function service(
  store,
  items = [{ book: media }],
  lookupIsbn = async () => ({ found: false, warnings: [] }),
) {
  return createSeriesInfoService(
    store,
    { lookupIsbn },
    { getAnimeAdaptations: async () => ({ items }) },
  );
}

test("ISBN enrichment retains descriptions from every source and reparses pinned publisher HTML offline", async () => {
  const store = await openTestStore();
  const isbn = "9786163377302";
  const url = "https://www.phoenixnext.com/moon-library.html";
  const sources = [
    {
      id: "phoenix",
      hosts: ["www.phoenixnext.com"],
      isbnPriority: 1,
      create: (context) => ({
        lookupIsbn: async () => {
          await context.fetchText(url);
          return {
            isbn,
            isbnVerified: true,
            title: "Moon Library",
            source: "Publisher",
            url,
          };
        },
      }),
    },
    {
      id: "open-library",
      hosts: ["openlibrary.org"],
      isbnPriority: 2,
      create: () => ({
        lookupIsbn: async () => ({
          isbn,
          title: "Moon Library",
          source: "Open Library",
          url: "https://openlibrary.org/isbn/" + isbn,
          synopses: [
            {
              text: "A second source synopsis.",
              language: "en",
              source: "Open Library",
              url: "https://openlibrary.org/isbn/" + isbn,
            },
          ],
        }),
      }),
    },
  ];
  try {
    const catalogs = createCatalogService(
      store,
      async () =>
        new Response(
          '<html lang="en"><div class="product-description"><p>เรื่องย่อภาษาไทย</p><div>Romaji: Tsuki no Toshokan</div></div></html>',
        ),
      sources,
    );
    const result = await catalogs.lookupIsbn(isbn);
    assert.equal(result.details.synopses.length, 2);
    assert.equal(result.details.titles[0].title, "Tsuki no Toshokan");
    assert.equal(result.details.source, "Publisher");
    const offline = createCatalogService(
      store,
      () => assert.fail("Pinned metadata must not be fetched again"),
      sources,
    );
    assert.deepEqual(
      (await offline.lookupIsbn(isbn)).details.synopses,
      result.details.synopses,
    );
  } finally {
    await store.close();
  }
});

test("exact AniList identity links language editions, shares choices, and never merges owned copies or adaptations", async () => {
  const store = await openTestStore();
  try {
    await add(store, "Moon Library");
    await add(store, "月の図書館", "(JP)", "Manga", "9784063951370");
    await add(store, "Moon Library: After Story");
    await add(store, "月の図書館", "(JP)", "Light novel");
    const api = service(store);
    const english = await api.pullSeriesInfo({
      series: "Moon Library",
      type: "Manga",
    });
    assert.equal(english.workId, "anilist:42");
    assert.equal(english.editions.length, 2);
    const japanese = await api.getSeriesInfo({
      series: "月の図書館",
      type: "Manga",
    });
    assert.deepEqual(english.synopses, japanese.synopses);
    assert.deepEqual(english.titles, japanese.titles);
    assert.equal(
      (await api.getSeriesInfo({ series: "月の図書館", type: "Light novel" }))
        .workId,
      "",
    );
    assert.equal(
      (
        await api.getSeriesInfo({
          series: "Moon Library: After Story",
          type: "Manga",
        })
      ).workId,
      "",
    );
    assert.equal((await store.api.getCollection()).books.length, 4);
    assert.equal(
      (await store.api.getCollection()).books.filter(
        (book) => book.series === "Moon Library",
      ).length,
      1,
    );
    await api.unlinkSeriesInfo({ series: "月の図書館", type: "Manga" });
    await api.pullSeriesInfo({ series: "Moon Library", type: "Manga" });
    assert.equal(
      (await api.getSeriesInfo({ series: "Moon Library", type: "Manga" }))
        .editions.length,
      1,
      "manual unlink survives automatic matching",
    );
  } finally {
    await store.close();
  }
});

test("publisher romaji resolves a Thai title, source variants survive outages, ambiguity requires selection", async () => {
  const store = await openTestStore();
  try {
    await add(store, "ห้องสมุดใต้แสงจันทร์", "(TH)", "Manga", "9786163377302");
    await add(store, "Moon Library");
    const source = {
      titles: [
        {
          title: "Tsuki no Toshokan",
          language: "ja-Latn",
          source: "Publisher",
          url: "https://example.com/book",
        },
      ],
      synopses: [
        {
          text: "เรื่องย่อภาษาไทย",
          language: "th",
          source: "Publisher",
          url: "https://example.com/book",
        },
      ],
    };
    const api = service(store, [{ book: media }], async () => ({
      found: true,
      details: source,
      warnings: [],
    }));
    const result = await api.pullSeriesInfo({
      series: "ห้องสมุดใต้แสงจันทร์",
      type: "Manga",
    });
    assert.equal(result.workId, "anilist:42");
    assert.equal(result.synopses.length, 2);
    assert.deepEqual(
      result.synopses,
      (await api.getSeriesInfo({ series: "Moon Library", type: "Manga" }))
        .synopses,
    );
    const offline = createSeriesInfoService(
      store,
      {
        lookupIsbn: async () => {
          throw new Error("offline");
        },
      },
      {
        getAnimeAdaptations: async () => {
          throw new Error("AniList offline");
        },
      },
    );
    assert.deepEqual(
      (
        await offline.pullSeriesInfo({
          series: "ห้องสมุดใต้แสงจันทร์",
          type: "Manga",
        })
      ).synopses,
      result.synopses,
    );
    assert.ok(
      (
        await offline.pullSeriesInfo({
          series: "ห้องสมุดใต้แสงจันทร์",
          type: "Manga",
        })
      ).warnings.length,
    );
    await add(store, "Unknown title");
    const ambiguous = service(store, [
      { book: media },
      { book: { ...media, id: 43 } },
    ]);
    const unlinked = await ambiguous.pullSeriesInfo({
      series: "Unknown title",
      type: "Manga",
      search: "Moon",
    });
    assert.ok(unlinked.workId.startsWith("local:"));
    assert.equal(unlinked.candidates.length, 2);
    assert.equal(unlinked.synopses.length, 0);
    const selected = await ambiguous.pullSeriesInfo({
      series: "Unknown title",
      type: "Manga",
      search: "Moon",
      mediaId: 42,
    });
    assert.equal(selected.workId, "anilist:42");
    await assert.rejects(
      ambiguous.pullSeriesInfo({
        series: "Unknown title",
        type: "Manga",
        mediaId: 999,
      }),
    );
  } finally {
    await store.close();
  }
});

test("manual links survive renames and backups, and remain private to the owning account", async () => {
  const store = await openTestStore();
  let restored;
  try {
    await add(store, "Moon Library");
    await add(store, "ฉบับไทย", "(TH)");
    const api = service(store);
    await api.pullSeriesInfo({ series: "Moon Library", type: "Manga" });
    await api.linkSeriesInfo({
      series: "ฉบับไทย",
      type: "Manga",
      targetSeries: "Moon Library",
    });
    const collection = await store.api.getCollection();
    await store.api.saveTitle({
      requestId: randomUUID(),
      series: "ฉบับไทย",
      token: collection.titles.find((title) => title.series === "ฉบับไทย")
        .token,
      title: {
        series: "ชื่อใหม่",
        editions: [
          {
            originalType: "Manga",
            originalPublisher: "",
            type: "Manga",
            publisher: "",
          },
        ],
      },
    });
    assert.equal(
      (await api.getSeriesInfo({ series: "ชื่อใหม่", type: "Manga" })).workId,
      "anilist:42",
    );
    const backup = await store.exportData();
    assert.equal(backup.seriesProfiles.length, 2);
    restored = await openTestStore();
    const plan = parseImport(
      Buffer.from(JSON.stringify(backup)),
      "backup.json",
    );
    await restored.importData(plan, plan.fingerprint);
    const imported = await service(restored).getSeriesInfo({
      series: "ชื่อใหม่",
      type: "Manga",
    });
    assert.equal(imported.editions.length, 2);
    assert.equal(imported.synopses.length, 1);
    const other = await store.db
      .prepare(
        "INSERT INTO users(username,role,created_at) VALUES ('other','user','now') RETURNING id",
      )
      .get();
    await store.forUser(
      { id: other.id, username: "other", role: "user" },
      async () => {
        await add(store, "Moon Library");
        assert.equal(
          (await api.getSeriesInfo({ series: "Moon Library", type: "Manga" }))
            .workId,
          "",
        );
        await assert.rejects(
          api.getSeriesInfo({ series: "ชื่อใหม่", type: "Manga" }),
          /not in your library/,
        );
      },
    );
  } finally {
    await restored?.close();
    await store.close();
  }
});
