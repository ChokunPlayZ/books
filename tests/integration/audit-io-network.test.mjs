import test from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { Readable } from "node:stream";
import { gzipSync, brotliCompressSync } from "node:zlib";
import {
  isPublicAddress,
  publicAddresses,
  publicFetch,
} from "../../lib/server/outbound.ts";
import { readBody } from "../../lib/server/http.ts";
import { createCoverService, coverDigest } from "../../lib/server/covers.ts";
import { createScraperContext } from "../../lib/server/scrapers/http.ts";
import { createAnimeService } from "../../lib/server/anime.ts";

const source = "https://www.phoenixnext.com/media/catalog/product/audit.png";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const publicAnswer = [{ address: "93.184.216.34", family: 4 }];

function cache() {
  const values = new Map();
  return {
    get: async (key) => values.get(key) ?? null,
    put: async (key, value) => values.set(key, value),
  };
}

function coverStore() {
  const sources = new Map();
  return {
    cache: cache(),
    covers: {
      bySource: async (url) => sources.get(url),
      put: async (image, url) => {
        const record = { ...image, id: coverDigest(image.body) };
        sources.set(url, record);
        return record;
      },
      allow: async () => {},
    },
  };
}

// Exercise the real transport and its socket lookup callback without opening
// Internet connections. A stub request must perform that lookup before it may
// deliver a response, just like node:https. No injected fetch bypass is used.
function nativeRemote(
  t,
  { answers = () => publicAnswer, respond = () => ({ body: png }) } = {},
) {
  const lookups = [],
    requests = [],
    connections = [];
  t.mock.method(dns, "lookup", async (hostname, options) => {
    lookups.push(hostname);
    assert.deepEqual(options, { all: true, verbatim: true });
    return answers(hostname, lookups.length);
  });
  t.mock.method(https, "request", (url, options, receive) => {
    requests.push(url.href);
    assert.equal(options.agent, false, "do not reuse unvalidated sockets");
    const req = new EventEmitter();
    req.end = (body) =>
      queueMicrotask(() => {
        options.lookup(url.hostname, { all: true }, (error, addresses) => {
          if (error) {
            req.emit("error", error);
            return;
          }
          connections.push({ hostname: url.hostname, addresses });
          const result = respond(url, options, body);
          const incoming = Readable.from([result.body || Buffer.alloc(0)], {
            objectMode: false,
          });
          incoming.statusCode = result.status || 200;
          incoming.headers = result.headers || {};
          incoming.rawHeaders = Object.entries(incoming.headers).flatMap(
            ([key, value]) =>
              (Array.isArray(value) ? value : [value]).flatMap((item) => [
                key,
                String(item),
              ]),
          );
          receive(incoming);
        });
      });
    return req;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { lookups, requests, connections };
}

test("audit IO: special-use IPv4, IPv6 and transition addresses are never public destinations", () => {
  for (const address of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "fe80::1",
    "fe80::1%en0",
    "fc00::1",
    "ff02::1",
    "64:ff9b::a00:1",
    "2001::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "3fff::1",
    "not-an-address",
  ])
    assert.equal(isPublicAddress(address), false, address);
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])
    assert.equal(isPublicAddress(address), true, address);
});

test("audit IO: empty and mixed public/private DNS answers fail closed", async () => {
  for (const answers of [
    [],
    [{ address: "127.0.0.1", family: 4 }],
    [...publicAnswer, { address: "fd00::1", family: 6 }],
  ])
    await assert.rejects(
      publicAddresses("publisher.example", async () => answers),
      /not a public address/,
    );
  assert.deepEqual(
    await publicAddresses("publisher.example", async () => publicAnswer),
    publicAnswer,
  );
});

test("audit IO: the default cover transport pins one checked DNS answer rather than resolving again", async (t) => {
  const remote = nativeRemote(t, {
    answers: (_host, call) =>
      call === 1 ? publicAnswer : [{ address: "127.0.0.1", family: 4 }],
  });
  const covers = createCoverService(coverStore());
  assert.deepEqual((await covers.ensure(source)).body, png);
  assert.deepEqual(remote.lookups, ["www.phoenixnext.com"]);
  assert.deepEqual(remote.connections[0].addresses, publicAnswer);
  await covers.ensure(source);
  assert.equal(remote.requests.length, 1, "stored sources remain offline");
});

test("audit IO: private DNS answers and rebinding on every redirect are blocked before connection", async (t) => {
  const remote = nativeRemote(t, {
    answers: (_host, call) =>
      call === 1 ? publicAnswer : [{ address: "169.254.169.254", family: 4 }],
    respond: () => ({
      status: 302,
      headers: { location: "https://books.googleusercontent.com/redirect.png" },
    }),
  });
  await assert.rejects(createCoverService(coverStore()).ensure(source), {
    status: 502,
  });
  assert.equal(remote.requests.length, 2);
  assert.equal(remote.connections.length, 1);
  assert.deepEqual(remote.lookups, [
    "www.phoenixnext.com",
    "books.googleusercontent.com",
  ]);
});

test("audit IO: literal addresses, credentials, plaintext and implicit redirects are refused", async () => {
  for (const url of [
    "https://127.1/a",
    "https://[::1]/a",
    "https://8.8.8.8/a",
    "http://example.org/a",
    "file:///etc/passwd",
    "https://u:p@example.org/a",
    "https://example.org:444/a",
  ])
    await assert.rejects(
      publicFetch(url, { redirect: "manual" }),
      /Unsupported outbound/,
    );
  await assert.rejects(
    publicFetch("https://example.org"),
    /explicit redirect policy/,
  );
});

test("audit IO: compressed publisher responses retain cookies and enforce decoded byte limits", async (t) => {
  let bomb = false;
  nativeRemote(t, {
    respond: () => ({
      body: gzipSync(
        bomb ? Buffer.alloc(9 * 1024 * 1024) : Buffer.from("publisher data"),
      ),
      headers: {
        "content-encoding": "gzip",
        "content-length": "20",
        "set-cookie": ["one=1; Path=/", "two=2; Path=/"],
      },
    }),
  });
  const response = await publicFetch(source, { redirect: "manual" });
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("content-length"), null);
  assert.deepEqual(response.headers.getSetCookie(), [
    "one=1; Path=/",
    "two=2; Path=/",
  ]);
  assert.equal((await readBody(response, 1024)).toString(), "publisher data");
  bomb = true;
  const context = createScraperContext(cache(), globalThis.fetch, [
    { hosts: ["www.phoenixnext.com"] },
  ]);
  await assert.rejects(context.requestRemote(source), { status: 413 });
});

test("audit IO: Brotli images remain supported and malformed encodings/statuses reject without uncaught exceptions", async (t) => {
  let kind = "brotli";
  nativeRemote(t, {
    respond: () =>
      kind === "brotli"
        ? {
            body: brotliCompressSync(png),
            headers: { "content-encoding": "br" },
          }
        : kind === "status"
          ? { status: 777 }
          : kind === "broken"
            ? {
                body: Buffer.from("not gzip"),
                headers: { "content-encoding": "gzip" },
              }
            : { headers: { "content-encoding": "unknown" } },
  });
  assert.deepEqual(
    (await createCoverService(coverStore()).ensure(source)).body,
    png,
  );
  kind = "status";
  await assert.rejects(publicFetch(source, { redirect: "manual" }), /status/);
  kind = "broken";
  await assert.rejects(
    readBody(await publicFetch(source, { redirect: "manual" })),
    (error) =>
      /header|compression|incorrect/i.test(
        error.cause?.message || error.message,
      ),
  );
  kind = "unknown";
  await assert.rejects(
    publicFetch(source, { redirect: "manual" }),
    /content encoding/,
  );
});

test("audit IO: AniList never follows redirects and its decoded JSON response is bounded", async (t) => {
  let redirected = true;
  const remote = nativeRemote(t, {
    respond: () =>
      redirected
        ? { status: 307, headers: { location: "https://127.0.0.1/internal" } }
        : {
            body: gzipSync(Buffer.alloc(9 * 1024 * 1024)),
            headers: { "content-encoding": "gzip" },
          },
  });
  await assert.rejects(
    createAnimeService({ cache: cache() }).getAnimeAdaptations({
      search: "Audit book",
    }),
    /redirect/,
  );
  assert.deepEqual(remote.requests, ["https://graphql.anilist.co/"]);
  redirected = false;
  await assert.rejects(
    createAnimeService({ cache: cache() }).getAnimeAdaptations({
      search: "Audit book",
    }),
    { status: 413 },
  );
});

test("audit IO: rejected scraper redirects cancel their bodies before throwing", async () => {
  let cancelled = false;
  const context = createScraperContext(
    cache(),
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 302, headers: { location: "https://127.0.0.1/internal" } },
      ),
    [{ hosts: ["www.phoenixnext.com"] }],
  );
  await assert.rejects(context.requestRemote(source), /redirect/);
  assert.equal(cancelled, true);
});
