import test from "node:test";
import assert from "node:assert/strict";
import { openTestStore } from "../helpers/database.mjs";
import { createApplicationApi } from "../../lib/server/api.ts";
import { createAccount } from "../../lib/server/auth.ts";

test("administrators search nested scraped content and raw response tails without remote work; long previews remain fully readable", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const api = createApplicationApi(
    store,
    { ensure: () => assert.fail("Inspection must not fetch images") },
    () => assert.fail("Inspection must not contact publishers"),
  );
  await store.cache.put(
    "scrape:v1:raw",
    JSON.stringify({
      source: "text:https://yenpress.com/catalog",
      checkedAt: Date.now(),
      value:
        "x".repeat(40000) +
        "<h1>Hidden Response Title</h1><script>window.cacheXss=true</script>" +
        "z".repeat(20000),
    }),
    Infinity,
  );
  await store.cache.put(
    "publisher-catalog:v1:nested",
    JSON.stringify({
      items: [{ title: "Nested searchable title", isbn: "9780316769488" }],
    }),
    Infinity,
  );
  assert.equal(
    (await api.getMetadataOverview({ search: "Hidden Response Title" })).total,
    1,
  );
  assert.equal(
    (
      await api.getMetadataOverview({
        search: "Nested searchable title",
        group: "catalogs",
      })
    ).total,
    1,
  );
  assert.equal(
    (await api.getMetadataOverview({ search: "9780316769488" })).total,
    1,
  );
  const preview = await api.getMetadataCacheEntry({
    key: "scrape:v1:raw",
    search: "Hidden Response Title",
  });
  assert.ok(preview.offset > 16000);
  assert.match(preview.content, /<h1>Hidden Response Title<\/h1>/);
  assert.ok(preview.nextOffset > preview.offset);
  assert.equal(preview.content.length, 16000);
  const final = await api.getMetadataCacheEntry({
    key: "scrape:v1:raw",
    offset: preview.nextOffset,
  });
  assert.equal(final.nextOffset, null);
  assert.ok(final.content.endsWith("z".repeat(100)));
  await assert.rejects(
    api.getMetadataCacheEntry({ key: "scrape:v1:raw", offset: -1 }),
    { status: 400 },
  );
  await store.cache.put("scrape:v1:literal", "A literal %_ marker", Infinity);
  assert.equal(
    (await api.getMetadataOverview({ search: "%_" })).total,
    1,
    "SQL wildcards are literal search text",
  );
});

test("cache searches paginate in PostgreSQL, preserve expiry/category filters and confirm before including private caches", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const api = createApplicationApi(store, {
    ensure: () => assert.fail("No image fetch"),
  });
  for (let index = 0; index < 25; index++)
    await store.cache.put(
      "publisher-catalog:v1:" + index,
      JSON.stringify({ items: [{ title: "Pagination title" }] }),
      index === 0 ? -1 : Infinity,
    );
  const page = await api.getMetadataOverview({
    search: "Pagination title",
    group: "catalogs",
    page: 2,
  });
  assert.equal(page.total, 25);
  assert.equal(page.entries.length, 5);
  assert.equal(page.pages, 2);
  assert.equal(
    (
      await api.getMetadataOverview({
        search: "Pagination title",
        expiredOnly: true,
      })
    ).total,
    1,
  );
  const reader = await createAccount(store, "reader", "reader@gmail.com");
  await store.forUser(reader, () =>
    store.cache.put(
      "series:v1:private",
      JSON.stringify({ series: "Unloaded private alias" }),
      Infinity,
    ),
  );
  const key = `user:${reader.id}:series:v1:private`;
  assert.equal(
    (await api.getMetadataOverview({ search: "Unloaded private alias" })).total,
    0,
  );
  await assert.rejects(api.getMetadataOverview({ includePrivate: true }), {
    status: 403,
  });
  await assert.rejects(api.getMetadataCacheEntry({ key }), { status: 403 });
  assert.equal(
    (
      await api.getMetadataOverview({
        includePrivate: true,
        confirmed: true,
        search: "Unloaded private alias",
      })
    ).total,
    1,
  );
  assert.match(
    (await api.getMetadataCacheEntry({ key, confirmed: true })).content,
    /Unloaded private alias/,
  );
  await store.forUser(reader, async () => {
    await assert.rejects(
      api.getMetadataOverview({ includePrivate: true, confirmed: true }),
      { status: 403 },
    );
    await assert.rejects(api.getMetadataCacheEntry({ key, confirmed: true }), {
      status: 403,
    });
  });
});
