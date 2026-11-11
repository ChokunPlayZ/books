import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canSuggest,
  mergeSuggestions,
} from "../../lib/domain/search-suggestions.ts";
import { createSearchService } from "../../lib/server/search.ts";
import { createSuggestionClient } from "../../lib/client/search-suggestions.ts";
import { SCRAPER_SOURCES } from "../../lib/server/scrapers/registry.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
const suggestion = (value, known = true) => ({
  value,
  label: "Previously found",
  known,
});
const noNetwork = () =>
  assert.fail("Completion must not request a remote resource");
function memoryStore(books = []) {
  const values = new Map();
  return {
    values,
    api: { getCollection: async () => ({ books, savedReleases: [] }) },
    cache: {
      get: (key) => values.get(key) ?? null,
      put: (key, value) => values.set(key, value),
      searchable: async () =>
        [...values]
          .filter(
            ([key]) =>
              key.startsWith("search-suggestions:") ||
              key.startsWith("publisher-catalog:"),
          )
          .map(([key, value]) => ({ key, value })),
    },
  };
}
function definitions(load) {
  return [
    {
      id: "phoenix",
      hosts: ["www.phoenixnext.com"],
      titleLanguages: ["th", "en"],
      create: () => ({ suggestTitles: load }),
    },
  ];
}

test("completion preserves Thai marks, deduplicates names and excludes fuzzy/ISBN/oversized queries", () => {
  for (const query of [
    "a",
    "",
    " ",
    "--",
    "98",
    "978616",
    "ISBN: 978-616",
    "0-14-032872-6",
    "9".repeat(201),
  ])
    assert.equal(canSuggest(query), false, query);
  for (const query of ["ดอกรั", "Moon", "図書", "86 Eighty Six"])
    assert.equal(canSuggest(query), true, query);
  assert.deepEqual(
    mergeSuggestions("Moon", [
      suggestion("moon library", false),
      suggestion("Moon Library"),
      suggestion("Moo Library"),
      suggestion("Moonlight"),
      suggestion("M".repeat(201)),
    ]).map((item) => item.value),
    ["Moon Library", "Moonlight"],
  );
  assert.equal(
    mergeSuggestions("ป่า", [suggestion("ป่า"), suggestion("ปา")]).length,
    1,
  );
});

test("known completion uses shelves, aliases and public catalogs without contacting publishers, and stops at enough distinct names", async () => {
  const store = memoryStore(
    Array.from({ length: 8 }, (_, index) => ({
      row: index + 1,
      series: "Moon Library " + String.fromCharCode(65 + index),
      volume: 1,
    })),
  );
  const service = createSearchService(
    store,
    {},
    noNetwork,
    definitions(noNetwork),
  );
  const known = await service.searchKnownSuggestions({ query: "Moon" });
  assert.equal(known.suggestions.length, 8);
  assert.ok(known.suggestions.every((item) => item.label === "Your library"));
  assert.deepEqual(known.sources, []);
  for (const query of ["978616", "9780140328721", "図書"])
    assert.deepEqual(
      (await service.searchKnownSuggestions({ query })).sources,
      [],
    );
  await assert.rejects(
    service.searchExternalSuggestions({ query: "図書", sourceId: "phoenix" }),
    /applicable/,
  );
});

test("completion discoveries and exact misses survive restarts and concurrent requests; narrower queries reuse names but not exhaustive coverage", async () => {
  const store = memoryStore();
  let calls = 0;
  const sources = definitions(async (query) => {
    calls++;
    return query === "Empty" ? [] : ["Moon Library", "Moon Garden"];
  });
  const service = createSearchService(store, {}, noNetwork, sources);
  const request = { query: "Moon", sourceId: "phoenix" };
  await Promise.all([
    service.searchExternalSuggestions(request),
    service.searchExternalSuggestions(request),
  ]);
  assert.equal(calls, 1);
  const reopened = createSearchService(store, {}, noNetwork, sources);
  assert.equal(
    (await reopened.searchKnownSuggestions({ query: "Moon L" })).suggestions[0]
      .value,
    "Moon Library",
  );
  assert.equal(
    (await reopened.searchKnownSuggestions({ query: "Moon L" })).sources.length,
    1,
    "truncated prefix results are not exhaustive",
  );
  assert.deepEqual(
    (await reopened.searchKnownSuggestions({ query: "Moon" })).sources,
    [],
  );
  await reopened.searchExternalSuggestions(request);
  await reopened.searchExternalSuggestions({
    query: "Empty",
    sourceId: "phoenix",
  });
  assert.deepEqual(
    (await reopened.searchKnownSuggestions({ query: "Empty" })).sources,
    [],
  );
  await reopened.searchExternalSuggestions({
    query: "Empty",
    sourceId: "phoenix",
  });
  assert.equal(calls, 2);
  assert.deepEqual(
    (await reopened.searchKnownEntities({ query: "Moon" })).results,
    [],
    "completions are not verified book listings",
  );
});

test("failed completion retains stale titles/check times and durable retry cooldown without recording a successful miss", async () => {
  const store = memoryStore();
  let calls = 0,
    failing = false;
  const service = createSearchService(
    store,
    {},
    noNetwork,
    definitions(async () => {
      calls++;
      if (failing) throw new Error("offline");
      return ["Moon Library"];
    }),
  );
  const request = { query: "Moon", sourceId: "phoenix" };
  await service.searchExternalSuggestions(request);
  for (const [key, value] of store.values) {
    const data = JSON.parse(value);
    data.checkedAt = 0;
    store.values.set(key, JSON.stringify(data));
  }
  failing = true;
  const failure = await service.searchExternalSuggestions(request);
  assert.equal(failure.unavailable, true);
  assert.equal(failure.suggestions[0].value, "Moon Library");
  await service.searchExternalSuggestions(request);
  assert.equal(calls, 2);
  const saved = JSON.parse(
    [...store.values].find(([key]) => key.startsWith("search-suggestions:"))[1],
  );
  assert.equal(saved.checkedAt, 0);
});

test("live-shape Phoenix, Naiin, Luckpim and Lnw completion adapters use only completion endpoints and do not persist sessions", async () => {
  const store = memoryStore();
  const calls = [];
  const service = createSearchService(store, {}, async (url, options) => {
    calls.push(url);
    if (url.includes("seriesbrands/ajax/searchbrands/"))
      return new Response(fixture("phoenix-suggestions.json"));
    if (url.includes("naiin.com/autocomplete"))
      return new Response(fixture("naiin-suggestions.json"));
    if (url === "https://www.luckpim.com/")
      return new Response(
        '<input name="__RequestVerificationToken" value="private-token">',
        { headers: { "Set-Cookie": "session=private-cookie; Secure" } },
      );
    if (url.includes("get/search_pin/key")) {
      assert.equal(new URL(url).searchParams.get("take"), "true");
      assert.equal(new URL(url).searchParams.get("limit"), "48");
      assert.equal(options.headers["XSRF-TOKEN"], "private-token");
      return Response.json({
        status: 200,
        data: {
          total: 1,
          list: [
            {
              slug: "2765",
              title: "กล่องรักวัยใส 21",
              main_category: "มังงะ/การ์ตูน",
            },
          ],
        },
      });
    }
    if (url.endsWith("/search/box")) {
      assert.equal(options.method, "POST");
      assert.equal(new URLSearchParams(options.body).get("q"), "รัก");
      return new Response(
        fixture("lnw-suggestions.html").replaceAll(
          "https://www.firstpagepro.com",
          new URL(url).origin,
        ),
      );
    }
    assert.fail("Unexpected non-completion request: " + url);
  });
  const phoenix = await service.searchExternalSuggestions({
    query: "ดอกรั",
    sourceId: "phoenix",
  });
  assert.equal(phoenix.suggestions[0].value, "ดอกรักผลิบานที่กลางใจ");
  assert.equal(
    (await service.searchKnownSuggestions({ query: "Kaoru" })).suggestions[0]
      .value,
    "Kaoru Hana wa Rin to Saku",
  );
  const naiin = await service.searchExternalSuggestions({
    query: "ดอกรั",
    sourceId: "naiin",
  });
  assert.equal(
    naiin.suggestions.length,
    1,
    "exclude authors/publishers and collapse volumes",
  );
  const luckpim = await service.searchExternalSuggestions({
    query: "รัก",
    sourceId: "luckpim",
  });
  assert.equal(luckpim.suggestions[0].value, "กล่องรักวัยใส");
  for (const sourceId of ["firstpage", "animag", "dexpress"])
    assert.ok(
      (await service.searchExternalSuggestions({ query: "รัก", sourceId }))
        .suggestions.length,
    );
  assert.equal(calls.length, 7);
  assert.doesNotMatch(
    [...store.values.values()].join(" "),
    /private-token|private-cookie/,
  );
});

test("malformed completion payloads remain failures, while explicit empty results are reusable", async () => {
  for (const body of [
    '{"error":"captcha"}',
    "[{}]",
    "<html>Service unavailable</html>",
  ]) {
    const store = memoryStore();
    const service = createSearchService(
      store,
      {},
      async () => new Response(body),
    );
    assert.equal(
      (
        await service.searchExternalSuggestions({
          query: "Moon",
          sourceId: "phoenix",
        })
      ).unavailable,
      true,
    );
    assert.ok(
      ![...store.values.keys()].some((key) =>
        key.startsWith("search-suggestions:"),
      ),
    );
  }
  for (const sourceId of [
    "phoenix",
    "naiin",
    "firstpage",
    "animag",
    "dexpress",
  ]) {
    const store = memoryStore();
    const service = createSearchService(
      store,
      {},
      async () =>
        new Response(
          ["phoenix", "naiin"].includes(sourceId)
            ? "[]"
            : '<li class="none"><div class="empty">ไม่พบข้อมูล</div></li>',
        ),
    );
    const response = await service.searchExternalSuggestions({
      query: "Moon",
      sourceId,
    });
    assert.deepEqual(response.suggestions, []);
    assert.ok(!response.unavailable);
    assert.ok(
      await service.cachedSearchSuggestions({ query: "Moon", sourceId }),
    );
  }
  assert.equal(
    SCRAPER_SOURCES.filter((source) => source.create({}).suggestTitles).length,
    6,
  );
});

test("client publishes known names before external suggestions, stops with enough matches, and reuses its bounded private cache", async () => {
  const calls = [],
    updates = [];
  const client = createSuggestionClient(async (name, arg) => {
    calls.push({ name, arg });
    if (name === "searchKnownSuggestions")
      return {
        query: arg.query,
        suggestions: [suggestion("Moon Library")],
        sources: ["one", "two", "three"].map((id) => ({ id, name: id })),
      };
    return {
      query: arg.query,
      suggestions: Array.from({ length: 6 }, (_, index) =>
        suggestion("Moon " + arg.sourceId + index),
      ),
      sources: [],
    };
  });
  const request = {
    query: "Moon",
    signal: new AbortController().signal,
    remoteDelay: 0,
    onSuggestions: (value) => updates.push(value),
  };
  await client.run(request);
  assert.equal(updates[1][0].value, "Moon Library");
  assert.equal(
    calls.length,
    3,
    "at most two simultaneous external sources; do not start third once sufficient",
  );
  await client.run(request);
  assert.equal(calls.length, 3);
  assert.ok(
    client.cached("Moon L").some((item) => item.value === "Moon Library"),
  );
});

test("superseded completion never publishes late names or starts queued providers", async () => {
  let finish, started;
  const ready = new Promise((resolve) => (started = resolve));
  const waiting = new Promise((resolve) => (finish = resolve));
  const controller = new AbortController();
  const updates = [],
    calls = [];
  const client = createSuggestionClient(async (name, arg) => {
    if (name === "searchKnownSuggestions")
      return {
        suggestions: [],
        sources: ["one", "two", "three"].map((id) => ({ id })),
      };
    calls.push(arg.sourceId);
    started();
    return waiting;
  });
  const pending = client.run({
    query: "Moon",
    signal: controller.signal,
    remoteDelay: 0,
    onSuggestions: (value) => updates.push(value),
  });
  await ready;
  controller.abort();
  finish({ suggestions: [suggestion("Moon late")] });
  await pending;
  assert.ok(updates.every((items) => !items.length));
  assert.deepEqual(calls, ["one", "two"]);
  assert.deepEqual(client.cached("Moon"), []);
});

test("sufficient local matches and ISBN input never contact completion providers", async () => {
  const calls = [];
  const client = createSuggestionClient(async (name) => {
    calls.push(name);
    assert.equal(name, "searchKnownSuggestions");
    return {
      suggestions: Array.from({ length: 6 }, (_, i) => suggestion("Moon " + i)),
      sources: [{ id: "unexpected" }],
    };
  });
  for (const query of ["Moon", "978616", "ISBN: 978-616"])
    await client.run({
      query,
      signal: new AbortController().signal,
      onSuggestions: () => {},
      remoteDelay: 0,
    });
  assert.deepEqual(calls, ["searchKnownSuggestions"]);
});
