import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openTestStore } from "../helpers/database.mjs";
import { createSeriesDetailsService } from "../../lib/server/series-details.ts";
import { createMetadataSuggestions } from "../../lib/server/metadata-suggestions.ts";
import { createSeriesInfoService } from "../../lib/server/series-info.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import { readFileSync } from "node:fs";

async function add(store, series, extra = {}) {
  return store.api.saveBook({
    requestId: randomUUID(),
    allowDuplicate: true,
    book: {
      series,
      type: "Manga",
      volume: 1,
      isbn: "",
      publisher: "Synthetic Press",
      edition: "(EN)",
      price: 80,
      status: "Read",
      source: "Test shop",
      date: "2026-11-11",
      note: "Private purchase note",
      coverUrl: "",
      publisherUrl: "",
      ...extra,
    },
  });
}

test("volume records retain separate owned copies, discover known catalog volumes and browse exact sourced creators", async () => {
  const store = await openTestStore();
  try {
    await add(store, "Synthetic Moon Library", {
      isbn: "9784063951370",
      msrp: 160,
      msrpCurrency: "THB",
    });
    await add(store, "Synthetic Moon Library", {
      isbn: "9784063951370",
      price: 70,
    });
    await add(store, "Synthetic Other Work");
    const fact = {
      label: "Author",
      value: "Synthetic Creator",
      source: "Publisher",
      url: "https://example.com/book",
    };
    for (const series of ["Synthetic Moon Library", "Synthetic Other Work"])
      await store.db
        .prepare("INSERT INTO series_profiles VALUES(app_user_id(),?,?,?)")
        .run(
          series,
          "Manga",
          JSON.stringify({
            workId: "local:" + randomUUID(),
            titles: [],
            synopses: [],
            facts: [fact],
          }),
        );
    await store.cache.put(
      "publisher-catalog:v1:test",
      JSON.stringify({
        items: [
          {
            series: "Synthetic Moon Library",
            title: "Synthetic Moon Library Vol. 1",
            type: "Manga",
            volume: 1,
            isbn: "9784063951370",
            publisher: "Synthetic Press",
            url: "https://example.com/volume1",
            pageCount: 192,
            msrp: 160,
            msrpCurrency: "THB",
          },
          {
            series: "Synthetic Moon Library",
            title: "Synthetic Moon Library Vol. 2",
            type: "Manga",
            volume: 2,
            isbn: "9781975325746",
            publisher: "Synthetic Press",
            url: "https://example.com/volume2",
            msrp: 170,
            msrpCurrency: "THB",
          },
          {
            series: "Synthetic Moon Library: After Story",
            type: "Manga",
            volume: 1,
            isbn: "",
            url: "https://example.com/sequel",
          },
        ],
      }),
      Infinity,
    );
    const api = createSeriesDetailsService(store);
    const { items } = await api.getSeriesVolumes({
      series: "Synthetic Moon Library",
      type: "Manga",
    });
    assert.equal(items.length, 3);
    assert.equal(items.filter((item) => item.owned).length, 2);
    assert.equal(items.find((item) => !item.owned).volume, 2);
    assert.equal(items[0].price, 80);
    assert.equal(items[0].pageCount, 192);
    assert.equal(
      (await api.getMetadataBrowse({ field: "Author", value: fact.value }))
        .books.length,
      3,
    );
    assert.equal(
      (await api.getMetadataBrowse({ field: "Author", value: "Creator" })).books
        .length,
      0,
    );
    await assert.rejects(
      api.getSeriesVolumes({ series: "Missing", type: "Manga" }),
      /not in your library/,
    );
  } finally {
    await store.close();
  }
});

test("a first volume-list visit pulls its linked catalog, reuses it for a day and refreshes automatically at expiry", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const store = await openTestStore();
  t.after(() => store.close());
  const series = "Synthetic linked shelf";
  const url =
    "https://www.phoenixnext.com/book-series/kaoru-hana-wa-rin-to-saku.html";
  await add(store, series, {
    publisher: "PHOENIX Next",
    edition: "(TH)",
    volume: 1,
  });
  await store.api.setSeriesCatalog({
    series,
    type: "Manga",
    publisherId: "phoenix",
    url,
  });
  const html = readFileSync(
    new URL(
      "../fixtures/series-catalogs/phoenix-category.html",
      import.meta.url,
    ),
    "utf8",
  );
  let requests = 0;
  let offline = false;
  const api = createApplicationApi(
    store,
    {
      ensure: async () => {
        throw new Error("No fixture images");
      },
    },
    async (endpoint) => {
      assert.equal(endpoint, url);
      requests++;
      return new Response(offline ? "Unavailable" : html, {
        status: offline ? 503 : 200,
      });
    },
  );
  const request = { series, type: "Manga" };
  const first = await api.getSeriesVolumes(request);
  const missing = first.items.filter((item) => !item.owned);
  assert.ok(missing.length > 0, "No earlier discovery visit is required");
  assert.ok(missing.every((item) => item.series === series));
  assert.equal(requests, 1);
  t.mock.timers.tick(24 * 60 * 60 * 1000 - 1);
  await api.getSeriesVolumes(request);
  assert.equal(requests, 1);
  t.mock.timers.tick(1);
  await api.getSeriesVolumes(request);
  assert.equal(requests, 2, "Expiry re-pulls without a forced refresh");

  offline = true;
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  const fallback = await api.getSeriesVolumes(request);
  assert.equal(requests, 3);
  assert.deepEqual(
    fallback.items.map((item) => item.key),
    first.items.map((item) => item.key),
    "An outage retains the known missing list and owned books",
  );
  await api.getSeriesVolumes(request);
  assert.equal(requests, 3, "Failed sources respect their retry cooldown");
});

test("suggestions persist without editing books or profiles, stay account-scoped, and require an administrator to review", async () => {
  const store = await openTestStore();
  try {
    await add(store, "Synthetic Moon Library");
    const before = (await store.api.getCollection()).books;
    const api = createMetadataSuggestions(store);
    const submitted = await api.suggestMetadataEdit({
      series: "Synthetic Moon Library",
      type: "Manga",
      field: "Author",
      proposed: "Correct creator",
      sourceUrl: "https://example.com/source",
      note: "Spelling correction",
    });
    assert.equal(submitted.status, "pending");
    assert.equal((await api.getMetadataSuggestions()).items.length, 1);
    assert.deepEqual((await store.api.getCollection()).books, before);
    await assert.rejects(
      api.suggestMetadataEdit({
        series: "Synthetic Moon Library",
        type: "Manga",
        field: "Author",
        proposed: "x",
        sourceUrl: "http://localhost/secret",
      }),
      /HTTPS/,
    );
    const user = await store.db
      .prepare(
        "INSERT INTO users(username,role,created_at) VALUES('suggestion-other','user','now') RETURNING id",
      )
      .get();
    await store.forUser(
      { id: user.id, username: "suggestion-other", role: "user" },
      async () => {
        assert.equal((await api.getMetadataSuggestions()).items.length, 0);
        await assert.rejects(
          api.getMetadataSuggestions({ all: true }),
          /administrator/,
        );
        await assert.rejects(
          api.reviewMetadataSuggestion({
            id: submitted.id,
            status: "reviewed",
          }),
          /administrator/,
        );
        await assert.rejects(
          api.suggestMetadataEdit({
            series: "Synthetic Moon Library",
            type: "Manga",
            field: "Author",
            proposed: "x",
          }),
          /not in your library/,
        );
      },
    );
    await api.reviewMetadataSuggestion({
      id: submitted.id,
      status: "reviewed",
    });
    assert.equal(
      (await api.getMetadataSuggestions({ all: true })).items[0].status,
      "reviewed",
    );
    await assert.rejects(
      api.reviewMetadataSuggestion({ id: submitted.id, status: "rejected" }),
      /already reviewed/,
    );
    assert.deepEqual((await store.api.getCollection()).books, before);
  } finally {
    await store.close();
  }
});

test("explicit Phoenix series sources are cached, preserved on read and reject non-series or offsite requests", async () => {
  const store = await openTestStore();
  try {
    await add(store, "หวานใจคุณไอศกรีม", { edition: "(TH)" });
    const html = readFileSync(
      new URL(
        "../fixtures/publishers/phoenix-series-profile.html",
        import.meta.url,
      ),
      "utf8",
    );
    let requests = 0;
    const catalogs = createCatalogService(store, async (url) => {
      requests++;
      assert.equal(url, "https://www.phoenixnext.com/series/icecreamkanojo");
      return new Response(html);
    });
    const api = createSeriesInfoService(store, catalogs, {
      getAnimeAdaptations: async () => ({ items: [] }),
    });
    const result = await api.pullSeriesInfo({
      series: "หวานใจคุณไอศกรีม",
      type: "Manga",
      sourceUrl: "https://www.phoenixnext.com/series/icecreamkanojo",
    });
    assert.ok(result.images.some((image) => image.kind === "banner"));
    assert.equal(
      (await api.getSeriesInfo({ series: "หวานใจคุณไอศกรีม", type: "Manga" }))
        .facts.length,
      5,
    );
    await catalogs.getSeriesSourceMetadata({
      url: "https://www.phoenixnext.com/series/icecreamkanojo",
    });
    assert.equal(requests, 1);
    await assert.rejects(
      catalogs.getSeriesSourceMetadata({
        url: "https://example.com/series/test",
      }),
      /Phoenix Next/,
    );
    assert.equal(requests, 1);
  } finally {
    await store.close();
  }
});
