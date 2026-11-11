import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { openTestStore } from "../helpers/database.mjs";
import { createSeriesInfoService } from "../../lib/server/series-info.ts";
import { parseAnimeMedia } from "../../lib/domain/anime.ts";
import { parseImport } from "../../lib/server/importer.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { preferredSynopses } from "../../lib/domain/metadata-source.ts";
import {
  createApplicationApi,
  applicationQueue,
} from "../../lib/server/api.ts";

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
async function add(
  store,
  series,
  edition = "(EN)",
  type = "Manga",
  isbn = "",
  publisherUrl = "",
) {
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
      publisherUrl,
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

test("automatic enrichment discovers no-ISBN titles and AniList, reuses attempts, and never skips explicit matching", async () => {
  const store = await openTestStore();
  try {
    await add(store, "ห้องสมุดใต้แสงจันทร์", "(TH)");
    let lookups = 0;
    let searches = 0;
    const api = createSeriesInfoService(
      store,
      {
        lookupIsbn: () => assert.fail("No ISBN is required"),
        lookupBook: async (request) => {
          lookups++;
          assert.equal(request.series, "ห้องสมุดใต้แสงจันทร์");
          return {
            found: true,
            warnings: [],
            details: {
              titles: [
                {
                  title: "Tsuki no Toshokan",
                  language: "ja-Latn",
                  source: "Phoenix Next",
                  url: "https://www.phoenixnext.com/moon.html",
                },
              ],
              synopses: [
                {
                  text: "เรื่องย่อภาษาไทย",
                  language: "th",
                  source: "Phoenix Next",
                  url: "https://www.phoenixnext.com/moon.html",
                },
              ],
            },
          };
        },
      },
      {
        getAnimeAdaptations: async () => {
          searches++;
          return { items: [{ book: media }] };
        },
      },
    );
    const request = {
      series: "ห้องสมุดใต้แสงจันทร์",
      type: "Manga",
      automatic: true,
    };
    const result = await api.pullSeriesInfo(request);
    assert.equal(result.workId, "anilist:42");
    assert.equal(result.synopses.length, 2);
    const count = searches;
    assert.deepEqual(
      (await api.pullSeriesInfo(request)).synopses,
      result.synopses,
    );
    assert.equal(lookups, 1);
    assert.equal(searches, count);
    await api.pullSeriesInfo({
      ...request,
      automatic: false,
      search: "Moon Library",
      mediaId: 42,
    });
    assert.equal(lookups, 2);
    assert.ok(searches > count);
  } finally {
    await store.close();
  }
});

test("automatic discovery keeps ambiguous matches available after reload and isolates accounts", async () => {
  const store = await openTestStore();
  try {
    await add(store, "Unknown title");
    let searches = 0;
    const api = createSeriesInfoService(
      store,
      { lookupIsbn: async () => ({ found: false }) },
      {
        getAnimeAdaptations: async () => {
          searches++;
          return { items: [{ book: media }, { book: { ...media, id: 43 } }] };
        },
      },
    );
    const request = { series: "Unknown title", type: "Manga", automatic: true };
    assert.equal((await api.pullSeriesInfo(request)).candidates.length, 2);
    assert.equal((await api.pullSeriesInfo(request)).candidates.length, 2);
    assert.equal(searches, 1);
    const other = await store.db
      .prepare(
        "INSERT INTO users(username,role,created_at) VALUES ('discovery-other','user','now') RETURNING id",
      )
      .get();
    await store.forUser(
      { id: other.id, username: "discovery-other", role: "user" },
      async () => {
        await add(store, "Unknown title");
        await api.pullSeriesInfo(request);
        assert.equal(searches, 2);
      },
    );
  } finally {
    await store.close();
  }
});

test("automatic discovery deduplicates work, falls back to bookstores during publisher outages, and rechecks changed editions", async () => {
  const store = await openTestStore();
  try {
    await add(
      store,
      "Moon Library",
      "(EN)",
      "Manga",
      "9786163377302",
      "https://www.phoenixnext.com/moon.html",
    );
    let lookups = 0;
    const bookstore = {
      text: "The store’s story.",
      language: "en",
      source: "Naiin",
      url: "https://www.naiin.com/product/detail/42",
    };
    const api = createSeriesInfoService(
      store,
      {
        getBookSourceMetadata: async () => {
          throw new Error("Publisher offline");
        },
        lookupIsbn: async () => {
          lookups++;
          return {
            found: true,
            warnings: [],
            details: { synopses: [bookstore] },
          };
        },
      },
      { getAnimeAdaptations: async () => ({ items: [{ book: media }] }) },
    );
    const request = { series: "Moon Library", type: "Manga", automatic: true };
    const results = await Promise.all([
      api.pullSeriesInfo(request),
      api.pullSeriesInfo(request),
    ]);
    assert.equal(lookups, 1);
    assert.deepEqual(preferredSynopses(results[0].synopses), [bookstore]);
    assert.ok(results[0].warnings.length);
    await api.pullSeriesInfo(request);
    assert.equal(lookups, 1, "Provider warnings have a retry cooldown");
    await add(store, "Moon Library", "(EN)", "Manga", "9786165898843");
    await api.pullSeriesInfo(request);
    assert.equal(lookups, 2, "Changed owned editions trigger new discovery");
  } finally {
    await store.close();
  }
});

test("automatic API enrichment returns promptly, runs in the background, and keeps status private", async () => {
  const store = await openTestStore();
  try {
    const url = "https://www.animagshop.com/product/1169";
    await add(store, "Moon Library", "(TH)", "Manga", "", url);
    let requests = 0;
    const api = createApplicationApi(
      store,
      { ensure: () => assert.fail("No image lookup is needed") },
      async (request) => {
        requests++;
        if (request === url)
          return new Response(
            readFileSync(
              new URL(
                "../fixtures/publishers/animag-synopsis.html",
                import.meta.url,
              ),
              "utf8",
            ),
          );
        assert.equal(request, "https://graphql.anilist.co");
        return Response.json({
          data: {
            Page: {
              media: [
                {
                  id: 42,
                  type: "MANGA",
                  format: "MANGA",
                  title: { english: "Moon Library" },
                  description: "The English series synopsis.",
                  relations: { edges: [] },
                },
              ],
            },
          },
        });
      },
    );
    const request = { series: "Moon Library", type: "Manga", automatic: true };
    const started = await api.pullSeriesInfo(request);
    assert.ok(started.discoveryJobId);
    assert.equal(requests, 0, "Starting discovery must not wait for providers");
    assert.equal((await api.getCollection()).books.length, 1);
    const pending = await api.getSeriesDiscovery({
      ...request,
      id: started.discoveryJobId,
    });
    assert.equal(pending.discoveryJobId, started.discoveryJobId);
    const job = await store.db
      .prepare("SELECT priority FROM scrape_jobs WHERE id=?")
      .get(started.discoveryJobId);
    assert.equal(job.priority, -10);
    await applicationQueue(store).wait(started.discoveryJobId);
    const ready = await api.getSeriesDiscovery({
      ...request,
      id: started.discoveryJobId,
    });
    assert.equal(ready.discoveryJobId, undefined);
    assert.equal(ready.workId, "anilist:42");
    assert.equal(ready.synopses.length, 2);
    const other = await store.db
      .prepare(
        "INSERT INTO users(username,role,created_at) VALUES ('background-other','user','now') RETURNING id",
      )
      .get();
    await store.forUser(
      { id: other.id, username: "background-other", role: "user" },
      async () => {
        await add(store, "Moon Library");
        await assert.rejects(
          api.getSeriesDiscovery({ ...request, id: started.discoveryJobId }),
          { status: 404 },
        );
      },
    );
  } finally {
    await store.close();
  }
});

test("saved supported product links supply readable synopses without ISBNs, reuse pages offline and reject unsafe links", async () => {
  const store = await openTestStore();
  const url = "https://www.animagshop.com/product/1169";
  const html = readFileSync(
    new URL("../fixtures/publishers/animag-synopsis.html", import.meta.url),
    "utf8",
  );
  try {
    await add(store, "Publisher-only edition", "(TH)", "Manga", "", url);
    await add(
      store,
      "Unsupported source",
      "(EN)",
      "Manga",
      "",
      "https://example.com/book",
    );
    const requests = [];
    const catalogs = createCatalogService(store, async (request) => {
      requests.push(request);
      assert.equal(
        request,
        url,
        "Backend requests must retain canonical URLs without attribution",
      );
      return new Response(html);
    });
    const api = createSeriesInfoService(store, catalogs, {
      getAnimeAdaptations: async () => ({ items: [] }),
    });
    const pulled = await api.pullSeriesInfo({
      series: "Publisher-only edition",
      type: "Manga",
    });
    assert.equal(pulled.synopses.length, 1);
    assert.match(pulled.synopses[0].text, /เรื่องราวความสำเร็จ/);
    assert.equal(pulled.synopses[0].source, "Animag");
    assert.equal(pulled.synopses[0].url, url);
    assert.deepEqual(
      (
        await api.getSeriesInfo({
          series: "Publisher-only edition",
          type: "Manga",
        })
      ).synopses,
      pulled.synopses,
    );
    const books = (await store.api.getCollection()).books;
    const offline = createCatalogService(store, () =>
      assert.fail("Source HTML should be cached"),
    );
    assert.deepEqual(
      (
        await offline.getBookSourceMetadata({
          row: books.find((book) => book.series === "Publisher-only edition")
            .row,
        })
      ).synopses,
      pulled.synopses,
    );
    assert.deepEqual(
      await offline.getBookSourceMetadata({
        row: books.find((book) => book.series === "Unsupported source").row,
      }),
      { titles: [], synopses: [] },
    );
    assert.equal(requests.length, 1);
  } finally {
    await store.close();
  }
});

test("an ISBN outage cannot skip a successful publisher synopsis, while mismatched product ISBNs are rejected", async () => {
  const store = await openTestStore();
  const url = "https://www.animagshop.com/product/1169";
  try {
    await add(
      store,
      "Publisher fallback",
      "(TH)",
      "Manga",
      "9786163377302",
      url,
    );
    await add(
      store,
      "Wrong product",
      "(TH)",
      "Manga",
      "9786165898843",
      "https://www.animagshop.com/product/1170",
    );
    const catalogs = createCatalogService(
      store,
      async (request) =>
        new Response(
          `<script type="application/ld+json">${JSON.stringify({
            sku: request === url ? "978616337-730-2" : "9780385496490",
            url: request,
            description: "The publisher's full synopsis.\nSecond paragraph.",
          })}</script>`,
        ),
    );
    const api = createSeriesInfoService(
      store,
      {
        lookupIsbn: async () => {
          throw new Error("ISBN provider unavailable");
        },
        getBookSourceMetadata: catalogs.getBookSourceMetadata,
      },
      { getAnimeAdaptations: async () => ({ items: [] }) },
    );
    const pulled = await api.pullSeriesInfo({
      series: "Publisher fallback",
      type: "Manga",
    });
    assert.equal(
      pulled.synopses[0].text,
      "The publisher's full synopsis.\nSecond paragraph.",
    );
    assert.ok(pulled.warnings.length);
    const wrong = (await store.api.getCollection()).books.find(
      (book) => book.series === "Wrong product",
    );
    assert.deepEqual(await catalogs.getBookSourceMetadata({ row: wrong.row }), {
      titles: [],
      synopses: [],
    });
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
