import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";

const fixture = (name) =>
  readFileSync(new URL("../fixtures/" + name, import.meta.url), "utf8");
const hour = 3600000;
const day = 24 * hour;
const category =
  "https://www.phoenixnext.com/book-series/kaoru-hana-wa-rin-to-saku.html";
const spec = (series) => ({
  publisherId: "phoenix",
  series,
  type: "Manga (TH)",
});

function database(t) {
  const directory = mkdtempSync(join(tmpdir(), "books-scrape-cache-"));
  const path = join(directory, "books.sqlite");
  let store = openStore(path);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    restart() {
      store.close();
      store = openStore(path);
      return store;
    },
  };
}

test("discovery and concurrent series aliases share pages across restarts without sharing annotations", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const db = database(t),
    calls = [];
  const remote = async (url) => {
    calls.push(url);
    return new Response(fixture("series-catalogs/phoenix-category.html"));
  };
  const aliases = ["First shelf title", "Another shelf title"];
  for (const alias of aliases)
    db.store.api.setSeriesCatalog({ ...spec(alias), url: category });
  let service = createCatalogService(db.store, remote);
  const [discovery, first, second] = await Promise.all([
    service.getPublisherCatalog({ url: category }),
    ...aliases.map((alias) => service.getSeriesCatalog(spec(alias))),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(discovery.complete, true);
  assert.ok(discovery.items.every((item) => !item.catalogSeries));
  assert.ok(first.items.every((item) => item.catalogSeries === aliases[0]));
  assert.ok(second.items.every((item) => item.catalogSeries === aliases[1]));

  const store = db.restart();
  const third = "New shelf alias after restart";
  store.api.setSeriesCatalog({ ...spec(third), url: category });
  service = createCatalogService(store, remote);
  assert.equal((await service.getSeriesCatalog(spec(third))).complete, true);
  assert.equal(calls.length, 1, "A new lookup reuses the durable page cache");
  t.mock.timers.tick(day - 1);
  await service.getSeriesCatalog(spec(third));
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1);
  await service.getSeriesCatalog(spec(third));
  assert.equal(calls.length, 2, "Catalog pages expire after a day");
});

test("release checks coalesce, expire after six hours and preserve stale results with durable retry backoff", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const db = database(t),
    calls = [];
  let offline = false;
  const remote = async (url) => {
    calls.push(url);
    return new Response(
      offline ? "Unavailable" : fixture("publishers/phoenix.html"),
      { status: offline ? 503 : 200 },
    );
  };
  let service = createCatalogService(db.store, remote);
  const request = { publisherId: "phoenix" };
  const checkTogether = (refresh = false) =>
    Promise.all(
      Array.from({ length: 8 }, () =>
        service.getPublisherReleases({ ...request, refresh }),
      ),
    );
  const [fresh] = await checkTogether();
  assert.equal(calls.length, 2, "One traversal serves all concurrent callers");
  t.mock.timers.tick(6 * hour - 1);
  await checkTogether();
  assert.equal(calls.length, 2);
  t.mock.timers.tick(1);
  const [updated] = await checkTogether();
  assert.equal(calls.length, 4);
  assert.notEqual(updated.checkedAt, fresh.checkedAt);
  await checkTogether(true);
  assert.equal(
    calls.length,
    6,
    "Explicit refresh bypasses fresh responses and still coalesces",
  );

  offline = true;
  const [stale] = await checkTogether(true);
  assert.equal(calls.length, 7);
  assert.equal(stale.stale, true);
  assert.equal(stale.checkedAt, updated.checkedAt);
  assert.deepEqual(stale.items, updated.items);
  service = createCatalogService(db.restart(), remote);
  await checkTogether(true);
  assert.equal(calls.length, 7, "A restart does not bypass failure cooldowns");
  t.mock.timers.tick(15 * 60000);
  offline = false;
  const [recovered] = await checkTogether(true);
  assert.equal(calls.length, 9);
  assert.equal(recovered.stale, false);

  t.mock.timers.tick(8 * day);
  offline = true;
  const old = await service.getPublisherReleases(request);
  assert.equal(
    old.stale,
    true,
    "Successful results remain available beyond a week",
  );
  assert.equal(old.checkedAt, recovered.checkedAt);
  assert.deepEqual(old.items, recovered.items);
});

test("publisher navigation is shared by discovery and series matching and reused for a week", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const db = database(t),
    calls = [];
  const remote = async (url) => {
    calls.push(url);
    return new Response(fixture("series-catalogs/phoenix-directory.html"));
  };
  const service = createCatalogService(db.store, remote);
  const load = () =>
    Promise.all([
      service.getSeriesCategories({ publisherId: "phoenix" }),
      service.getPublisherDirectory({
        url: "https://www.phoenixnext.com/book-series.html",
      }),
    ]);
  const [categories, directory] = await load();
  assert.ok(categories.categories.length);
  assert.ok(directory.titles.length);
  assert.equal(calls.length, 1);
  t.mock.timers.tick(7 * day - 1);
  await load();
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1);
  await load();
  assert.equal(calls.length, 2);
});

test("Luckpim shares public series results without persisting session tokens or cookies", async (t) => {
  const db = database(t),
    calls = [];
  const remote = async (url, options) => {
    calls.push(url);
    if (url.includes("get/search_pin/key")) {
      assert.equal(options.headers["XSRF-TOKEN"], "secret-token");
      assert.equal(options.headers.Cookie, "catalog-session=secret-cookie");
      return new Response(fixture("series-catalogs/luckpim-series.json"));
    }
    return new Response(
      "<input name=__RequestVerificationToken value=secret-token>",
      {
        headers: { "Set-Cookie": "catalog-session=secret-cookie; Path=/" },
      },
    );
  };
  const linked = (series) => ({
    publisherId: "luckpim",
    series,
    type: "Manga (TH)",
  });
  const link = (series) =>
    db.store.api.setSeriesCatalog({
      ...linked(series),
      url: "https://www.luckpim.com/search_result?k=Public%20title",
    });
  link("First alias");
  link("Second alias");
  let service = createCatalogService(db.store, remote);
  const results = await Promise.all(
    ["First alias", "Second alias"].map((series) =>
      service.getSeriesCatalog(linked(series)),
    ),
  );
  assert.equal(calls.length, 2);
  assert.ok(results.every((result) => result.complete));
  assert.ok(
    results[0].items.every((item) => item.catalogSeries === "First alias"),
  );
  assert.ok(
    results[1].items.every((item) => item.catalogSeries === "Second alias"),
  );
  const persisted = JSON.stringify(
    db.store.db.prepare("SELECT key, value FROM cache").all(),
  );
  assert.ok(!persisted.includes("secret-token"));
  assert.ok(!persisted.includes("secret-cookie"));

  db.restart();
  link("Third alias");
  service = createCatalogService(db.store, remote);
  assert.equal(
    (await service.getSeriesCatalog(linked("Third alias"))).complete,
    true,
  );
  assert.equal(calls.length, 2);
  await service.getSeriesCatalog({ ...linked("Third alias"), refresh: true });
  assert.equal(
    calls.length,
    4,
    "A refresh obtains a new session only when needed",
  );
});

test("equivalent ISBN lookups share requests and cache confirmed misses for a day", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const db = database(t),
    calls = [];
  const remote = async (url) => {
    calls.push(url);
    if (url.startsWith("https://kinokuniya.co.th/products/"))
      return new Response("Not found", { status: 404 });
    return new Response(
      url.includes("naiin")
        ? '<product-list :items="[]">'
        : url.includes("yaakz")
          ? '{"data":[],"total":0}'
          : url === "https://yenpress.com/search"
            ? fixture("publishers/yenpress-search.html")
            : url.includes("enterprise-search.yenpress.com")
              ? '{"results":[]}'
              : "{}",
    );
  };
  let service = createCatalogService(db.store, remote);
  const results = await Promise.all(
    ["0140328726", "9780140328721"].map((isbn) => service.lookupIsbn(isbn)),
  );
  assert.ok(
    results.every((result) => !result.found && !result.warnings.length),
  );
  assert.equal(calls.length, 7);
  service = createCatalogService(db.restart(), remote);
  t.mock.timers.tick(day - 1);
  await service.lookupIsbn("9780140328721");
  assert.equal(calls.length, 7);
  t.mock.timers.tick(1);
  await service.lookupIsbn("9780140328721");
  assert.equal(calls.length, 14);
});
