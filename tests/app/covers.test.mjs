import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCoverCache } from "../../lib/server/covers.mjs";

const source = "https://www.phoenixnext.com/media/catalog/product/cover.jpg";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const imageResponse = () =>
  new Response(png, { headers: { "Content-Type": "image/png" } });
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "books-covers-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("cover bytes persist across cache instances and simultaneous requests download once", async (t) => {
  const path = await directory(t);
  let calls = 0;
  const cache = createCoverCache({
    directory: path,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, source);
      assert.equal(options.redirect, "manual");
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal instanceof AbortSignal);
      return imageResponse();
    },
  });
  const results = await Promise.all(
    Array.from({ length: 12 }, () => cache.get(source)),
  );
  assert.equal(calls, 1);
  for (const result of results) {
    assert.deepEqual(result.body, png);
    assert.equal(result.contentType, "image/png");
    assert.match(result.etag, /^"[a-f0-9]{64}"$/);
    assert.equal(result.stale, false);
  }
  const files = await readdir(path);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[a-f0-9]{64}\.cover$/);
  assert.deepEqual(await readFile(join(path, files[0])), png);
  const restarted = createCoverCache({
    directory: path,
    fetchImpl: () =>
      assert.fail("A fresh cached image must not use the network."),
  });
  assert.deepEqual((await restarted.get(source)).body, png);
  assert.equal((await restarted.get(source)).etag, results[0].etag);
});

test("expired covers refresh after 30 days and retain the last image during an outage", async (t) => {
  const path = await directory(t);
  let calls = 0,
    fail = false;
  const cache = createCoverCache({
    directory: path,
    fetchImpl: async () => {
      calls++;
      if (fail) throw new Error("Publisher offline");
      return imageResponse();
    },
  });
  const fresh = await cache.get(source);
  const file = join(path, (await readdir(path))[0]);
  const expired = new Date(Date.now() - 31 * 86400000);
  await utimes(file, expired, expired);
  fail = true;
  const stale = await cache.get(source);
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.body, png);
  assert.equal(stale.etag, fresh.etag);
  fail = false;
  assert.equal((await cache.get(source)).stale, false);
  await cache.get(source);
  assert.equal(calls, 3);
});

test("cover sources and redirects reject arbitrary hosts, credentials and insecure requests", async (t) => {
  const path = await directory(t);
  const calls = [];
  let location = "https://127.0.0.1/private";
  const cache = createCoverCache({
    directory: path,
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(null, { status: 302, headers: { location } });
    },
  });
  for (const unsafe of [
    null,
    "",
    "file:///etc/passwd",
    "http://www.phoenixnext.com/cover.jpg",
    "https://127.0.0.1/cover.jpg",
    "https://www.phoenixnext.com.evil.test/cover.jpg",
    "https://www.phoenixnext.com:444/cover.jpg",
    "https://user:password@www.phoenixnext.com/cover.jpg",
  ])
    await assert.rejects(cache.get(unsafe), { status: 400 });
  assert.deepEqual(calls, []);
  for (location of [
    "https://127.0.0.1/private",
    "http://www.phoenixnext.com/cover.jpg",
    "https://www.phoenixnext.com:444/cover.jpg",
  ]) {
    const before = calls.length;
    await assert.rejects(cache.get(source), { status: 502 });
    assert.equal(calls.length - before, 1);
  }
  assert.deepEqual(await readdir(path), []);
});

test("supported image redirects are followed and cached under the original source", async (t) => {
  const path = await directory(t);
  const calls = [];
  const target = "https://books.googleusercontent.com/cover.png";
  const cache = createCoverCache({
    directory: path,
    fetchImpl: async (url) => {
      calls.push(url);
      return url === source
        ? new Response(null, { status: 302, headers: { location: target } })
        : imageResponse();
    },
  });
  assert.deepEqual((await cache.get(source)).body, png);
  await cache.get(source);
  assert.deepEqual(calls, [source, target]);
  let hops = 0;
  await assert.rejects(
    createCoverCache({
      directory: await directory(t),
      fetchImpl: async () => {
        hops++;
        return new Response(null, {
          status: 302,
          headers: { location: source },
        });
      },
    }).get(source),
    { status: 502 },
  );
  assert.equal(hops, 4);
});

test("HTML, SVG, empty images, failed responses and corrupt cache files are never served", async (t) => {
  const path = await directory(t);
  let response = imageResponse;
  const cache = createCoverCache({
    directory: path,
    fetchImpl: () => response(),
  });
  for (response of [
    () =>
      new Response("<html>Not an image</html>", {
        headers: { "Content-Type": "image/jpeg" },
      }),
    () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    () => new Response(null),
    () => new Response("Unavailable", { status: 503 }),
  ]) {
    await assert.rejects(cache.get(source), { status: 502 });
    assert.deepEqual(await readdir(path), []);
  }
  response = imageResponse;
  await cache.get(source);
  await writeFile(join(path, (await readdir(path))[0]), "corrupt image");
  assert.deepEqual((await cache.get(source)).body, png);
});

test("cover downloads enforce the size limit for declared and streamed bodies", async (t) => {
  const path = await directory(t);
  const limit = 5 * 1024 * 1024;
  for (const response of [
    () =>
      new Response(png, { headers: { "Content-Length": String(limit + 1) } }),
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(png);
            controller.enqueue(new Uint8Array(limit));
            controller.close();
          },
        }),
      ),
  ]) {
    await assert.rejects(
      createCoverCache({ directory: path, fetchImpl: response }).get(source),
      { status: 502 },
    );
    assert.deepEqual(await readdir(path), []);
  }
});
