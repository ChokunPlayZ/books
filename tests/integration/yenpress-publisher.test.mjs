import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import {
  yenPressDirectoryTitles,
  yenPressSeriesCatalog,
  yenPressCalendar,
  yenPressPrintReleases,
  yenPressSeriesNextUrl,
} from "../../lib/domain/yenpress-catalogs.ts";
import {
  PUBLISHERS,
  publisherKey,
  safeSeriesCatalogUrl,
  safePublisherUrl,
  publisherCatalogSource,
  catalogSeriesKey,
  cleanRelease,
} from "../../lib/domain.ts";
import {
  matchRelease,
  discoverTitles,
  publisherKey as clientPublisherKey,
  releaseSeriesKey,
} from "../../lib/client/matching.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
const json = (name) => JSON.parse(fixture(name));
const url = "https://yenpress.com/series/solo-leveling-comic";
const spec = {
  publisherId: "yenpress",
  series: "Solo Leveling",
  type: "Manga (EN)",
};
const book = {
  isbn: "9781975319434",
  series: spec.series,
  volume: 1,
  type: spec.type,
  publisher: "Ize Press",
  status: "Read",
};
function database(t) {
  const store = openStore(":memory:");
  t.after(() => store.close());
  return store;
}
function remote(
  calls,
  { offline = false, repeat = false, incomplete = false } = {},
) {
  return async (requested, options) => {
    calls.push({ url: requested, options });
    if (offline) return new Response("Offline", { status: 503 });
    if (requested === "https://yenpress.com/search")
      return new Response(fixture("yenpress-search.html"));
    if (requested.includes("enterprise-search.yenpress.com")) {
      const query = JSON.parse(options.body);
      if (query.filters?.all?.some((filter) => filter.type === "series"))
        return new Response(
          fixture(
            query.page.current === 1 || repeat
              ? "yenpress-directory-1.json"
              : "yenpress-directory-2.json",
          ),
        );
      if (query.filters?.all?.some((filter) => Array.isArray(filter.isbn)))
        return new Response(fixture("yenpress-print-releases.json"));
      return new Response('{"results":[]}');
    }
    if (requested === "https://yenpress.com/calendar")
      return new Response(fixture("yenpress-calendar.html"));
    if (requested === url)
      return new Response(
        incomplete
          ? fixture("yenpress-series.html").replace(
              'href="/titles/9781975319434-',
              'href="/unlisted/9781975319434-',
            )
          : fixture("yenpress-series.html"),
      );
    if (requested.includes("/titles/9781975319434-"))
      return new Response(fixture("yenpress-comic.html"));
    if (requested.includes("naiin"))
      return new Response('<product-list :items="[]">');
    assert.fail("Unexpected publisher request: " + requested);
  };
}

test("Yen Press is a publisher, its imprints share matching, and series URL validation stays on the publisher site", () => {
  assert.ok(PUBLISHERS.some((publisher) => publisher.id === "yenpress"));
  for (const name of ["Yen Press", "Yen On", "Ize Press", "JY"]) {
    assert.equal(publisherKey(name), "yenpress");
    assert.equal(clientPublisherKey(name), "yenpress");
    assert.equal(safePublisherUrl(url, name), url);
    assert.equal(safePublisherUrl("https://evil.test/book", name), "");
  }
  assert.equal(safeSeriesCatalogUrl(url + "/", "yenpress"), url);
  assert.equal(
    publisherCatalogSource("https://yenpress.com").publisherId,
    "yenpress",
  );
  assert.equal(publisherCatalogSource(url).url, url);
  for (const unsafe of [
    url + "?format=Digital",
    url.replace("yenpress.com", "yenpress.com.evil.test"),
    url.replace("https://", "http://"),
    url.replace("https://", "https://user:pass@"),
    url.replace("yenpress.com", "yenpress.com:8080"),
  ])
    assert.equal(safeSeriesCatalogUrl(unsafe, "yenpress"), "");
  assert.equal(
    catalogSeriesKey("Solo Leveling (comic)"),
    catalogSeriesKey(book.series),
  );
  assert.equal(
    releaseSeriesKey("Solo Leveling (comic)"),
    releaseSeriesKey(book.series),
  );
  const records = json("yenpress-directory-1.json").results;
  const manga = structuredClone(records[1]);
  manga.imprint_id.raw = "2";
  assert.equal(yenPressDirectoryTitles([manga])[0].type, "Manga (EN)");
  assert.equal(discoverTitles(yenPressDirectoryTitles(records), []).length, 2);
});

test("series pages read all fifteen print volumes, exact covers and formats, excluding navigation and related series", () => {
  const parsed = yenPressSeriesCatalog(fixture("yenpress-series.html"), url);
  assert.equal(parsed.title, "Solo Leveling (comic)");
  assert.equal(parsed.complete, true);
  assert.equal(parsed.total, 15);
  assert.equal(parsed.items.length, 15);
  const first = parsed.items.find((item) => item.volume === 1);
  assert.equal(first.isbn, book.isbn);
  assert.equal(first.type, "Manga (EN)");
  assert.equal(first.price, "");
  assert.equal(first.series, "Solo Leveling (comic)");
  assert.match(first.coverUrl, /\/imgs\/9781975319434\.jpg/);
  assert.equal(matchRelease(first, [book]).owned.length, 1);
  assert.equal(cleanRelease(first).publisherId, "yenpress");
  const uncounted = yenPressSeriesCatalog(
    fixture("yenpress-series.html").replaceAll(/<sup\b[^>]*>15<\/sup>/g, ""),
    url,
  );
  assert.equal(uncounted.complete, false);
  const missing = yenPressSeriesCatalog(
    fixture("yenpress-series.html").replace(
      'href="/titles/9781975319434-',
      'href="/unlisted/9781975319434-',
    ),
    url,
  );
  assert.equal(missing.complete, false);
  assert.equal(missing.items.length, 14);
  assert.throws(
    () => yenPressSeriesCatalog("<h1>Maintenance</h1>", url),
    /markup changed/,
  );
});

test("release calendar confirms physical ISBNs with the index and excludes chapters, audio and digital-only books", () => {
  const candidates = yenPressCalendar(fixture("yenpress-calendar.html"));
  assert.equal(candidates.length, 4);
  const items = yenPressPrintReleases(
    json("yenpress-print-releases.json"),
    candidates,
  );
  assert.equal(items.length, 3);
  assert.ok(
    items.every((item) => item.price === "" && !/\bChapter\b/.test(item.title)),
  );
  assert.ok(items.some((item) => item.type === "LN (EN)"));
  assert.ok(items.some((item) => item.type === "Manga (EN)"));
  assert.ok(items.every((item) => /Oct 2026/.test(item.availability)));
  assert.ok(!items.some((item) => item.isbn === "9798855455267"));
  const partial = json("yenpress-print-releases.json");
  partial.meta.page.total_results++;
  assert.throws(() => yenPressPrintReleases(partial, candidates), /incomplete/);
  assert.throws(() => yenPressCalendar("<h1>Calendar</h1>"), /changed/);
});

test("discovery paginates the full series index, resolves first volumes, shares the directory with automatic series matching and persists across restart", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "books-yenpress-publisher-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "library.sqlite");
  let store = openStore(path);
  t.after(() => store.close());
  const calls = [],
    fetchImpl = remote(calls);
  let service = createCatalogService(store, fetchImpl);
  const discovered = await service.getPublisherDirectory({
    url: "https://yenpress.com/",
  });
  assert.equal(discovered.titles.length, 3);
  assert.equal(discovered.stale, false);
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls
      .filter((call) => call.options.method === "POST")
      .map((call) => JSON.parse(call.options.body).page.current),
    [1, 2],
  );
  const comic = discovered.titles.find((entry) => entry.url === url);
  const first = await service.getPublisherTitle({
    publisherId: "yenpress",
    series: comic.series,
    categories: comic.categories,
  });
  assert.equal(first.complete, true);
  assert.equal(first.item.volume, 1);
  assert.equal(first.item.isbn, book.isbn);
  store.api.saveBook({ requestId: "yenpress_publisher_1", book });
  const catalog = await service.getSeriesCatalog(spec);
  assert.equal(catalog.complete, true);
  assert.equal(catalog.needsSelection, false);
  assert.ok(catalog.items.every((item) => !item.catalogVariant));
  assert.equal(
    calls.length,
    4,
    "Discovery and series comparison share their public resources",
  );
  assert.equal(
    discoverTitles([comic], store.api.getCollection().books).length,
    0,
  );
  store.close();
  store = openStore(path);
  service = createCatalogService(store, () =>
    assert.fail("Cached catalog should work offline"),
  );
  const cached = await service.getSeriesCatalog(spec);
  assert.equal(cached.items[0].series, "Solo Leveling (comic)");
  assert.ok(cached.items.every((item) => !item.catalogVariant));
  assert.equal(
    (await service.getPublisherDirectory({ url: "https://yenpress.com/" }))
      .titles.length,
    3,
  );
});

test("publisher releases and selected series links survive outages and malformed pagination never replaces a good directory", async (t) => {
  const store = database(t),
    calls = [];
  let service = createCatalogService(store, remote(calls));
  const releases = await service.getPublisherReleases({
    publisherId: "yenpress",
  });
  assert.equal(releases.items.length, 3);
  assert.equal(releases.stale, false);
  await service.getPublisherDirectory({ url: "https://yenpress.com/" });
  store.api.setSeriesCatalog({
    ...spec,
    series: "My translated title",
    url,
    title: "Solo Leveling (comic)",
  });
  const linked = await service.getSeriesCatalog({
    ...spec,
    series: "My translated title",
  });
  assert.equal(linked.complete, true);
  assert.ok(
    linked.items.every(
      (item) =>
        item.catalogSeries === "My translated title" && !item.catalogVariant,
    ),
  );
  service = createCatalogService(store, remote(calls, { repeat: true }));
  const partial = await service.getPublisherDirectory({
    url: "https://yenpress.com/",
    refresh: true,
  });
  assert.equal(partial.stale, true);
  assert.equal(partial.titles.length, 3);
  service = createCatalogService(store, remote(calls, { offline: true }));
  const stale = await service.getPublisherReleases({
    publisherId: "yenpress",
    refresh: true,
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.checkedAt, releases.checkedAt);
  assert.equal(stale.items.length, 3);
  const oldSeries = await service.getSeriesCatalog({
    ...spec,
    series: "My translated title",
    refresh: true,
  });
  assert.equal(oldSeries.stale, true);
  assert.equal(oldSeries.items.length, 15);
});

test("publisher cover lookup works without an ISBN and uses the exact owned volume", async (t) => {
  const store = database(t),
    calls = [],
    service = createCatalogService(store, remote(calls));
  store.api.saveBook({
    requestId: "yenpress_publisher_cover",
    book: { ...book, isbn: "" },
  });
  const cover = await service.getBookCover({ row: 1 });
  assert.match(cover.coverUrl, /\/imgs\/9781975319434\.jpg/);
  const choices = await service.getBookCoverOptions({ row: 1 });
  assert.equal(choices.covers.length, 1);
  assert.equal(
    choices.covers[0].publisherUrl,
    "https://yenpress.com/titles/9781975319434-solo-leveling-vol-1-comic",
  );
});

test("long series follow only same-series print continuation links, deduplicate overlaps, and retain a complete check after a partial refresh", async (t) => {
  const store = database(t),
    calls = [],
    seriesUrl = "https://yenpress.com/series/spice-and-wolf";
  let failing = false;
  const service = createCatalogService(store, async (url, options) => {
    calls.push({ url, options });
    if (url === seriesUrl)
      return new Response(fixture("yenpress-long-series.html"));
    assert.equal(new URL(url).pathname, "/series/get_more/spice-and-wolf");
    assert.equal(options.headers["X-Requested-With"], "XMLHttpRequest");
    return new Response(
      failing ? "Offline" : fixture("yenpress-series-more.html").repeat(2),
      { status: failing ? 503 : 200 },
    );
  });
  const seriesSpec = {
    publisherId: "yenpress",
    series: "Spice and Wolf",
    type: "LN (EN)",
  };
  store.api.setSeriesCatalog({ ...seriesSpec, url: seriesUrl });
  const catalog = await service.getSeriesCatalog(seriesSpec);
  assert.equal(catalog.complete, true);
  assert.equal(catalog.total, 24);
  assert.equal(catalog.items.length, 25);
  assert.equal(catalog.pages, 2);
  assert.ok(catalog.items.some((item) => item.volume === 1));
  assert.ok(catalog.items.every((item) => item.type === "LN (EN)"));
  assert.equal(calls.length, 2);
  failing = true;
  const stale = await service.getSeriesCatalog({
    ...seriesSpec,
    refresh: true,
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.items.length, 25);
  assert.equal(stale.checkedAt, catalog.checkedAt);
  for (const raw of [
    "https://evil.test/series/get_more/spice-and-wolf?format%5B0%5D=Paperback&next_ord=10",
    "/series/get_more/another-series?format%5B0%5D=Paperback&next_ord=10",
    "/series/get_more/spice-and-wolf?format%5B0%5D=Digital&next_ord=10",
    "/series/get_more/spice-and-wolf?format%5B0%5D=Paperback&next_ord=10&redirect=evil",
  ])
    assert.throws(() => yenPressSeriesNextUrl(raw, seriesUrl), /Unsupported/);
});
