import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";

const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );
const isbn = "9786166247275";
const sources = [
  "www.naiin.com",
  "www.yaakz.com",
  "www.firstpagepro.com",
  "www.animagshop.com",
  "www.phoenixnext.com",
  "yenpress.com",
  "kinokuniya.co.th",
  "www.googleapis.com",
  "openlibrary.org",
];
function emptyResponse(address) {
  const host = new URL(address).hostname;
  if (host === "www.naiin.com")
    return new Response('<product-list :items="[]">');
  if (host === "www.yaakz.com") return new Response('{"data":[],"total":0}');
  if (host === "www.firstpagepro.com")
    return new Response('<span class="tsk-all">0</span>');
  if (host === "www.animagshop.com")
    return new Response(fixture("animag-empty.html"));
  if (host === "www.phoenixnext.com")
    return new Response('<div class="message info empty">Empty</div>');
  if (host === "yenpress.com")
    return new Response(fixture("yenpress-search.html"));
  if (host === "enterprise-search.yenpress.com")
    return new Response('{"results":[]}');
  if (host === "kinokuniya.co.th")
    return new Response("Not found", { status: 404 });
  return new Response("{}");
}
function googleResponse() {
  return Response.json({
    items: [
      {
        volumeInfo: {
          title: "Generic edition",
          industryIdentifiers: [{ identifier: isbn }],
        },
      },
    ],
  });
}
async function controlledLookup(t, respond = emptyResponse) {
  const store = openStore(":memory:");
  const gates = new Map(
    sources.map((source) => [source, Promise.withResolvers()]),
  );
  const calls = [];
  const completed = new Set();
  const service = createCatalogService(store, async (address) => {
    calls.push(address);
    const host = new URL(address).hostname;
    await gates.get(host)?.promise;
    completed.add(host);
    return respond(address);
  });
  const result = service.lookupIsbn(isbn);
  t.after(async () => {
    gates.forEach((gate) => gate.resolve());
    await result;
    store.close();
  });
  await setImmediate();
  return { store, gates, calls, completed, result };
}

test("ISBN sources start together and keep source preference when a generic match finishes first", async (t) => {
  const { store, gates, calls, completed, result } = await controlledLookup(
    t,
    (address) => {
      if (address.includes("naiin.com"))
        return new Response(
          fixture(
            address.includes("search-result")
              ? "naiin-search.html"
              : "naiin-detail.html",
          ),
        );
      if (address.includes("googleapis.com")) return googleResponse();
      if (address.includes("openlibrary.org"))
        return new Response("Unavailable", { status: 503 });
      return emptyResponse(address);
    },
  );
  assert.deepEqual(
    calls.map((address) => new URL(address).hostname).sort(),
    [...sources].sort(),
    "Every source must start before any response is released",
  );
  assert.equal(completed.size, 0);
  gates.forEach((gate, source) => {
    if (source !== "www.naiin.com") gate.resolve();
  });
  await setImmediate();
  assert.ok(completed.has("www.googleapis.com"));
  assert.ok(!completed.has("www.naiin.com"));
  gates.get("www.naiin.com").resolve();
  const lookup = await result;
  assert.equal(lookup.details.source, "Naiin");
  assert.equal(lookup.details.volume, 22);
  assert.deepEqual(lookup.warnings, []);
  const offline = createCatalogService(store, () =>
    assert.fail("The completed lookup must be cached"),
  );
  assert.deepEqual(await offline.lookupIsbn(isbn), lookup);
});

test("parallel ISBN failures retain ordered warnings and allow a verified fallback", async (t) => {
  const { gates, result } = await controlledLookup(t, (address) => {
    if (/naiin|firstpagepro|openlibrary/.test(address))
      return new Response("Unavailable", { status: 503 });
    if (address.includes("googleapis.com")) return googleResponse();
    return emptyResponse(address);
  });
  for (const source of [...sources].reverse()) {
    gates.get(source).resolve();
    await setImmediate();
  }
  const lookup = await result;
  assert.equal(lookup.details.source, "Google Books");
  assert.deepEqual(lookup.warnings, [
    "Naiin is unavailable right now. You can still search it using the link below.",
    "First Page Pro is unavailable right now.",
  ]);
});

test("a parallel lookup with all sources unavailable returns a cached miss with warnings", async (t) => {
  const { store, gates, result } = await controlledLookup(
    t,
    () => new Response("Unavailable", { status: 503 }),
  );
  gates.forEach((gate) => gate.resolve());
  const lookup = await result;
  assert.equal(lookup.found, false);
  assert.equal(lookup.details, null);
  assert.equal(lookup.warnings.length, sources.length);
  const offline = createCatalogService(store, () =>
    assert.fail("Provider outages must respect the cached retry cooldown"),
  );
  assert.deepEqual(await offline.lookupIsbn(isbn), lookup);
});
