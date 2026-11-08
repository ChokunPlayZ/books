import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseImport } from "../../lib/server/importer.ts";
import { AppError } from "../../lib/server/store.ts";
import { json, errorResponse, sameOrigin } from "../../lib/server/http.ts";
import { THEME_INIT_SCRIPT } from "../../lib/theme.ts";
import { textHtml } from "../../lib/domain/html.ts";
import { seriesPath, seriesFromPath } from "../../lib/domain/navigation.ts";
import {
  safeCoverUrl,
  safeProductUrl,
  safePublisherUrl,
  safeSeriesCatalogUrl,
} from "../../lib/domain/urls.ts";

const payload = '</script><img src=x onerror="globalThis.compromised=true">';

test("browser audit: imported text is data, while executable metadata URLs are rejected", () => {
  const plan = parseImport(
    Buffer.from(
      JSON.stringify([
        { series: payload, publisher: payload, source: payload, note: payload },
      ]),
    ),
    "untrusted.json",
  );
  for (const field of ["series", "publisher", "source", "note"])
    assert.equal(plan.books[0][field], payload);
  // textHtml is a source-text decoder, NOT an HTML sanitizer. Its callers must
  // keep using React escaping/textContent (also exercised in the browser test).
  assert.equal(
    textHtml("&lt;img src=x onerror=alert(1)&gt;"),
    "<img src=x onerror=alert(1)>",
  );

  for (const url of [
    "javascript:alert(document.domain)",
    " \tJaVaScRiPt:alert(1)",
    "java\nscript:alert(1)",
    "java&#x73;cript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://www.phoenixnext.com/book.html",
    "//www.phoenixnext.com/book.html",
    "https://www.phoenixnext.com@evil.test/book.html",
    "https://www.phoenixnext.com.evil.test/book.html",
    "https://www.phoenixnext.com:444/book.html",
    "https://user:password@www.phoenixnext.com/book.html",
  ]) {
    assert.equal(safePublisherUrl(url, "phoenix"), "", url);
    assert.equal(safeProductUrl(url, "phoenix"), "", url);
    assert.equal(safeSeriesCatalogUrl(url, "phoenix"), "", url);
    assert.equal(safeCoverUrl(url), "", url);
    for (const field of ["publisherUrl", "coverUrl"])
      assert.throws(
        () =>
          parseImport(
            Buffer.from(
              JSON.stringify([
                {
                  series: "Untrusted",
                  publisher: "Phoenix Next",
                  [field]: url,
                },
              ]),
            ),
            "untrusted.json",
          ),
        undefined,
        `${field}: ${url}`,
      );
    assert.throws(
      () =>
        parseImport(
          Buffer.from(
            JSON.stringify({
              format: "book-collection",
              version: 1,
              books: [],
              savedReleases: [{ publisherId: "phoenix", title: payload, url }],
            }),
          ),
          "untrusted.json",
        ),
      undefined,
      `saved release: ${url}`,
    );
  }
});

test("browser audit: arbitrary series titles cannot change navigation origin or route structure", () => {
  for (const title of [
    payload,
    "javascript:alert(1)",
    "//evil.test",
    "../data?x=1#y",
    "100% / เล่มหนึ่ง 😀",
    "\u0000\r\n",
  ]) {
    const path = seriesPath(title);
    assert.match(path, /^\/series\/[A-Za-z0-9_-]+$/);
    assert.equal(
      new URL(path, "https://books.test").origin,
      "https://books.test",
    );
    assert.equal(seriesFromPath(path.slice("/series/".length), [title]), title);
  }
});

test("browser audit: the theme bootstrap never evaluates stored strings", () => {
  for (const account of [undefined, "light", "dark", "system", payload]) {
    for (const stored of [null, "light", "dark", "system", payload]) {
      for (const systemDark of [false, true]) {
        let storageReads = 0;
        const document = {
          documentElement: { dataset: { accountTheme: account } },
        };
        const context = {
          document,
          localStorage: {
            getItem() {
              storageReads++;
              return stored;
            },
          },
          matchMedia: () => ({ matches: systemDark }),
        };
        vm.runInNewContext(THEME_INIT_SCRIPT, context);
        const selected = account || stored;
        assert.equal(
          document.documentElement.dataset.theme,
          selected === "light" || selected === "dark"
            ? selected
            : systemDark
              ? "dark"
              : "light",
        );
        assert.equal(storageReads, account ? 0 : 1);
        assert.equal(context.compromised, undefined);
      }
    }
  }
  const document = { documentElement: { dataset: {} } };
  vm.runInNewContext(THEME_INIT_SCRIPT, {
    document,
    localStorage: {
      getItem() {
        throw new Error("Storage unavailable");
      },
    },
    matchMedia: () => ({ matches: false }),
  });
  assert.equal(document.documentElement.dataset.theme, "light");
});

test("browser audit: API origin checks reject cross-origin browser mutations", (t) => {
  const previous = process.env.BOOKS_APP_URL;
  delete process.env.BOOKS_APP_URL;
  t.after(() => {
    if (previous === undefined) delete process.env.BOOKS_APP_URL;
    else process.env.BOOKS_APP_URL = previous;
  });
  const request = (headers) =>
    new Request("https://books.test/api/rpc", { method: "POST", headers });
  for (const headers of [
    { Origin: "https://evil.test" },
    { Origin: "https://books.test.evil.test" },
    { Origin: "http://books.test" },
    { Origin: "https://books.test:444" },
    { Origin: "null" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" },
    { Origin: "https://evil.test", "X-Forwarded-Host": "evil.test" },
  ])
    assert.throws(() => sameOrigin(request(headers)), { status: 403 });
  assert.doesNotThrow(() =>
    sameOrigin(
      request({
        Origin: "https://books.test",
        "Sec-Fetch-Site": "same-origin",
      }),
    ),
  );
  // Headerless non-browser clients are intentionally allowed by this API.
  assert.doesNotThrow(() => sameOrigin(request({})));
});

test("browser audit: API JSON successes and errors are non-cacheable, non-HTML responses", async () => {
  for (const response of [
    json({ title: payload }),
    errorResponse(new AppError(payload, 403)),
  ]) {
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    const data = await response.json();
    assert.equal(data.title || data.message, payload);
  }
});

function serviceWorkerHarness() {
  const origin = "https://books.test";
  const listeners = new Map();
  const entries = new Map();
  const writes = [];
  const deleted = [];
  const network = [];
  let failNetwork = false;
  let status = 200;
  let claimed = false;
  let skipped = false;
  const context = {
    URL,
    Response,
    Request: class extends Request {
      constructor(url, options) {
        super(new URL(url, origin), options);
      }
    },
    self: {
      location: { origin },
      addEventListener(name, handler) {
        listeners.set(name, handler);
      },
      async skipWaiting() {
        skipped = true;
      },
      clients: {
        async claim() {
          claimed = true;
        },
      },
    },
    caches: {
      async keys() {
        return [...entries.keys()];
      },
      async delete(key) {
        deleted.push(key);
        return entries.delete(key);
      },
      async open(key) {
        if (!entries.has(key)) entries.set(key, new Map());
        const cache = entries.get(key);
        return {
          async add(request) {
            writes.push({ key, url: request.url, cache: request.cache });
            cache.set(
              new URL(request.url, origin).href,
              new Response("public offline screen"),
            );
          },
          async match(url) {
            return cache.get(new URL(url, origin).href)?.clone();
          },
          async put() {
            assert.fail(
              "The worker must never cache fetched private responses",
            );
          },
        };
      },
    },
    async fetch(request) {
      network.push(request.url);
      if (failNetwork) throw new TypeError("Offline");
      return new Response("private library response", { status });
    },
  };
  vm.runInNewContext(
    readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"),
    context,
  );
  return {
    entries,
    writes,
    deleted,
    network,
    get claimed() {
      return claimed;
    },
    get skipped() {
      return skipped;
    },
    set offline(value) {
      failNetwork = value;
    },
    set status(value) {
      status = value;
    },
    async lifecycle(name) {
      let pending;
      listeners.get(name)({
        waitUntil(value) {
          pending = value;
        },
      });
      await pending;
    },
    fetch(path, overrides = {}) {
      let pending;
      listeners.get("fetch")({
        request: {
          url: new URL(path, origin).href,
          mode: "navigate",
          method: "GET",
          ...overrides,
        },
        respondWith(value) {
          pending = value;
        },
      });
      return pending;
    },
  };
}

test("browser audit: worker caches only public offline HTML and deletes only its old caches", async () => {
  const worker = serviceWorkerHarness();
  worker.entries.set("book-collection-offline-v0", new Map());
  worker.entries.set("book-collection-offline-v1", new Map());
  worker.entries.set("unrelated-application", new Map());
  await worker.lifecycle("install");
  assert.equal(worker.skipped, true);
  assert.equal(worker.writes.length, 1);
  assert.equal(worker.writes[0].url, "https://books.test/offline.html");
  assert.equal(worker.writes[0].cache, "reload");
  await worker.lifecycle("activate");
  assert.equal(worker.claimed, true);
  assert.deepEqual(worker.deleted, [
    "book-collection-offline-v0",
    "book-collection-offline-v1",
  ]);
  assert.equal(worker.entries.has("unrelated-application"), true);

  assert.equal(
    await (await worker.fetch("/series/private-title")).text(),
    "private library response",
  );
  for (const status of [401, 403, 500]) {
    worker.status = status;
    const response = await worker.fetch("/data");
    assert.equal(response.status, status);
    assert.equal(await response.text(), "private library response");
  }
  worker.offline = true;
  assert.equal(
    await (await worker.fetch("/series/private-title")).text(),
    "public offline screen",
  );
  assert.equal(
    worker.writes.length,
    1,
    "Private documents must never enter CacheStorage",
  );
});

test("browser audit: worker never intercepts APIs, covers, RSC/static assets, writes, or external requests", async () => {
  const worker = serviceWorkerHarness();
  await worker.lifecycle("install");
  worker.offline = true;
  for (const [path, overrides] of [
    ["/api", {}],
    ["/api/backup", {}],
    ["/api/covers/" + "a".repeat(64), {}],
    ["/_next/static/chunk.js", {}],
    ["/api/rpc", { method: "POST", mode: "cors" }],
    ["/data", { method: "POST" }],
    ["/?_rsc=secret", { mode: "cors" }],
    ["https://evil.test/", {}],
  ])
    assert.equal(worker.fetch(path, overrides), undefined, path);
  assert.deepEqual(worker.network, []);
  assert.equal(worker.writes.length, 1);
});
