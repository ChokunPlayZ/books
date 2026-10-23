import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../lib/server/store.ts";
import { createAnimeService } from "../../lib/server/anime.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import { manga, novel, searchMedia, seasonMedia } from "../helpers/anime.mjs";

const response = (media, hasNextPage = false) =>
  new Response(
    JSON.stringify({ data: { Page: { media, pageInfo: { hasNextPage } } } }),
  );

test("AniList search validates input, filters format, preserves title ambiguity, caches and coalesces requests", async () => {
  const store = openStore(":memory:");
  let calls = 0;
  const service = createAnimeService(store, async (url, options) => {
    calls++;
    assert.equal(url, "https://graphql.anilist.co");
    assert.equal(options.method, "POST");
    const { variables } = JSON.parse(options.body);
    assert.deepEqual(variables.formats, ["MANGA", "ONE_SHOT"]);
    return response(searchMedia);
  });
  try {
    for (const arg of [
      [],
      "Moon",
      {},
      { search: "a" },
      { search: "x".repeat(201) },
      { search: "Moon", type: "ANIME" },
    ])
      await assert.rejects(service.getAnimeAdaptations(arg));
    assert.equal(calls, 0);
    const request = { search: "Moonlit Library", type: "Manga" };
    const [first, second] = await Promise.all([
      service.getAnimeAdaptations(request),
      service.getAnimeAdaptations(request),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(first, second);
    assert.equal(first.exactId, manga.id);
    first.items.length = 0;
    assert.equal((await service.getAnimeAdaptations(request)).items.length, 1);
    assert.equal(calls, 1);
    const ambiguous = createAnimeService(store, async () =>
      response([manga, { ...novel, title: manga.title }]),
    );
    assert.equal(
      (await ambiguous.getAnimeAdaptations({ search: "Moonlit Library" }))
        .exactId,
      null,
    );
    assert.equal(
      (await ambiguous.getAnimeAdaptations({ search: "A fuzzy title" }))
        .exactId,
      null,
    );
  } finally {
    store.close();
  }
});

test("seasonal pagination merges books and stale results survive process restarts and partial failures", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "books-anime-")),
    "library.sqlite",
  );
  let store = openStore(path),
    calls = 0;
  let service = createAnimeService(store, async (_url, options) => {
    calls++;
    const { variables } = JSON.parse(options.body);
    return response(
      variables.page === 1 ? [seasonMedia[0]] : [seasonMedia[1]],
      variables.page === 1,
    );
  });
  const spec = { season: "FALL", year: 2026 };
  const fresh = await service.getSeasonalAnimeBooks(spec);
  assert.equal(calls, 2);
  assert.equal(fresh.items.length, 3);
  assert.equal(fresh.complete, true);
  store.close();
  store = openStore(path);
  calls = 0;
  service = createAnimeService(store, async (_url, options) => {
    calls++;
    return JSON.parse(options.body).variables.page === 1
      ? response([seasonMedia[0]], true)
      : new Response("unavailable", { status: 503 });
  });
  try {
    assert.deepEqual(await service.getSeasonalAnimeBooks(spec), fresh);
    assert.equal(calls, 0);
    const stale = await service.getSeasonalAnimeBooks({
      ...spec,
      refresh: true,
    });
    assert.equal(stale.stale, true);
    assert.equal(stale.checkedAt, fresh.checkedAt);
    assert.equal(stale.items.length, 3);
    assert.equal(calls, 2);
    await service.getSeasonalAnimeBooks({ ...spec, refresh: true });
    assert.equal(calls, 2, "retry cooldown protects failed sources");
  } finally {
    store.close();
  }
});

test("AniList rate limits apply across queries and malformed or failed GraphQL data never becomes an empty success", async () => {
  const store = openStore(":memory:");
  let calls = 0;
  const limited = createAnimeService(store, async () => {
    calls++;
    return new Response("", { status: 429, headers: { "retry-after": "120" } });
  });
  try {
    await assert.rejects(
      limited.getAnimeAdaptations({ search: "A title" }),
      /request limit/,
    );
    await assert.rejects(
      limited.getSeasonalAnimeBooks({ season: "FALL", year: 2026 }),
      /busy/,
    );
    assert.equal(calls, 1);
    for (const body of [
      { errors: [{ message: "failure" }], data: { Page: { media: [] } } },
      { data: {} },
      { data: { Page: { media: [null] } } },
    ]) {
      const isolated = openStore(":memory:");
      try {
        await assert.rejects(
          createAnimeService(
            isolated,
            async () => new Response(JSON.stringify(body)),
          ).getAnimeAdaptations({ search: "A title" }),
          /complete results/,
        );
      } finally {
        isolated.close();
      }
    }
  } finally {
    store.close();
  }
});

test("season requests reject invalid filters before contacting AniList and default to the current season", async () => {
  const store = openStore(":memory:");
  let calls = 0;
  const service = createAnimeService(store, async (_url, options) => {
    calls++;
    const { variables } = JSON.parse(options.body);
    assert.equal(variables.year, new Date().getUTCFullYear());
    assert.ok(
      ["WINTER", "SPRING", "SUMMER", "FALL"].includes(variables.season),
    );
    return response([]);
  });
  try {
    for (const arg of [
      [],
      { season: "AUTUMN" },
      { year: "2026" },
      { year: 1939 },
      { year: 9999 },
      { year: 2026.1 },
    ])
      await assert.rejects(service.getSeasonalAnimeBooks(arg));
    assert.equal(calls, 0);
    assert.deepEqual((await service.getSeasonalAnimeBooks()).items, []);
    assert.equal(calls, 1);
    const api = createApplicationApi(
      store,
      { ensure: () => assert.fail("Anime metadata must not download covers") },
      async () => response(searchMedia),
    );
    assert.equal(
      (await api.getAnimeAdaptations({ search: "Moonlit Library" })).exactId,
      manga.id,
    );
  } finally {
    store.close();
  }
});
