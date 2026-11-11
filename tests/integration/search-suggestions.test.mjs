import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openTestStore } from "../helpers/database.mjs";
import { createAccount } from "../../lib/server/auth.ts";
import {
  createApplicationApi,
  applicationQueue,
} from "../../lib/server/api.ts";
import { createSearchService } from "../../lib/server/search.ts";

test("completion isolates private names/aliases, shares only public suggestions and serves fresh cache while the remote queue is paused", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const alice = await createAccount(
    store,
    "completion-alice",
    "completion-alice@gmail.com",
  );
  const bob = await createAccount(
    store,
    "completion-bob",
    "completion-bob@gmail.com",
  );
  let requests = 0;
  const api = createApplicationApi(
    store,
    { ensure: () => assert.fail("Completion must not download covers") },
    async (url) => {
      requests++;
      assert.ok(url.includes("seriesbrands/ajax/searchbrands/"));
      return Response.json([{ brand_name: "Moon Public" }]);
    },
  );
  await store.forUser(alice, async () => {
    await store.api.saveBook({
      requestId: randomUUID(),
      book: {
        series: "Moon Private",
        type: "Manga",
        volume: 1,
        status: "Unread",
        note: "Secret purchase note",
      },
    });
    await store.cache.put(
      "series:v1:private-completion",
      JSON.stringify({
        publisherId: "phoenix",
        items: [{ title: "Moon Private Alias" }],
      }),
      3600,
    );
    const local = await api.searchKnownSuggestions({ query: "Moon" });
    assert.deepEqual(local.suggestions.map((item) => item.value).sort(), [
      "Moon Private",
      "Moon Private Alias",
    ]);
    assert.equal(requests, 0);
  });
  await store.forUser(bob, async () => {
    assert.deepEqual(
      (await api.searchKnownSuggestions({ query: "Moon" })).suggestions,
      [],
    );
    const online = await api.searchExternalSuggestions({
      query: "Moon",
      sourceId: "phoenix",
    });
    assert.equal(online.suggestions[0].value, "Moon Public");
    assert.equal(requests, 1);
    assert.equal(
      (await store.cache.searchable()).some((row) =>
        row.key.startsWith("search-suggestions:"),
      ),
      false,
      "completion names must not become verified book/series metadata",
    );
  });
  await store.forUser(alice, async () => {
    const local = await api.searchKnownSuggestions({ query: "Moon" });
    assert.ok(local.suggestions.some((item) => item.value === "Moon Public"));
    const admin = await store.db
      .prepare("SELECT id,username,role FROM users WHERE role='admin' LIMIT 1")
      .get();
    await store.forUser(admin, () => api.manageScrapeQueue({ paused: true }));
    const jobs = await store.db
      .prepare("SELECT count(*) AS count FROM scrape_jobs")
      .get();
    const reused = await api.searchExternalSuggestions({
      query: "Ｍｏｏｎ",
      sourceId: "phoenix",
    });
    assert.equal(reused.suggestions[0].value, "Moon Public");
    assert.deepEqual(
      await store.db.prepare("SELECT count(*) AS count FROM scrape_jobs").get(),
      jobs,
    );
    assert.equal(requests, 1);
    const data = (
      await store.db
        .prepare(
          "SELECT value FROM cache WHERE key LIKE 'search-suggestions:%'",
        )
        .all()
    )
      .map((row) => row.value)
      .join(" ");
    assert.doesNotMatch(data, /Private|Alias|purchase|note/);
  });
  await store.forUser(bob, async () => {
    const reopened = createSearchService(store, {}, () =>
      assert.fail("Durable completion cache must survive service restart"),
    );
    assert.deepEqual(
      (
        await reopened.searchKnownSuggestions({ query: "Moon" })
      ).suggestions.map((item) => item.value),
      ["Moon Public"],
    );
    assert.equal((await store.api.getCollection()).books.length, 0);
  });
  applicationQueue(store).stop();
});
