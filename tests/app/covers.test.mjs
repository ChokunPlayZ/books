import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCoverService, coverDigest } from "../../lib/server/covers.mjs";
import { openStore } from "../../lib/server/store.mjs";
import { createApplicationApi } from "../../lib/server/api.mjs";
import { parseImport } from "../../lib/server/importer.mjs";
import { volumeCoverKey_ } from "../../lib/domain.mjs";

const source = "https://www.phoenixnext.com/media/catalog/product/cover.jpg";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const imageResponse = () =>
  new Response(png, { headers: { "Content-Type": "image/png" } });
function database(t) {
  const store = openStore(":memory:");
  t.after(() => store.close());
  return store;
}
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "books-covers-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
const book = {
  series: "Stored cover",
  type: "Manga (TH)",
  publisher: "Phoenix Next",
  status: "Read",
  volume: 1,
};

test("image bytes live in SQLite, concurrent downloads deduplicate, and IDs survive restarts and source outages", async (t) => {
  const path = join(await directory(t), "library.sqlite");
  let store = openStore(path);
  let calls = 0;
  const covers = createCoverService(store, {
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
    Array.from({ length: 12 }, () => covers.ensure(source)),
  );
  assert.equal(calls, 1);
  const id = coverDigest(png);
  assert.ok(results.every((image) => image.id === id));
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM covers").get().n, 1);
  assert.deepEqual(
    Buffer.from(
      store.db.prepare("SELECT body FROM covers WHERE id=?").get(id).body,
    ),
    png,
  );
  assert.throws(() => covers.get("https://127.0.0.1/private"), { status: 400 });
  assert.throws(() => covers.get("0".repeat(64)), { status: 404 });
  store.close();
  store = openStore(path);
  t.after(() => store.close());
  const restarted = createCoverService(store, {
    fetchImpl: () => assert.fail("Stored images must not use the network"),
  });
  assert.deepEqual(restarted.get(id).body, png);
  assert.equal(restarted.get(id).etag, '"' + id + '"');
  assert.equal((await restarted.ensure(source)).id, id);
});

test("content IDs deduplicate different sources and old file caches migrate without a download", async (t) => {
  const store = database(t);
  const legacyDirectory = await directory(t);
  await writeFile(join(legacyDirectory, coverDigest(source) + ".cover"), png);
  let calls = 0;
  const covers = createCoverService(store, {
    legacyDirectory,
    fetchImpl: async () => {
      calls++;
      return imageResponse();
    },
  });
  const migrated = await covers.ensure(source);
  assert.equal(calls, 0);
  const second = await covers.ensure("https://du.lnwfile.com/same-cover.png");
  assert.equal(calls, 1);
  assert.equal(migrated.id, second.id);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM covers").get().n, 1);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM cover_sources").get().n,
    2,
  );
});

test("API choices, saved volumes, trash and JSON restore retain stored cover IDs and bytes offline", async (t) => {
  const store = database(t);
  const covers = createCoverService(store, { fetchImpl: imageResponse });
  const api = createApplicationApi(store, covers, () =>
    assert.fail("Manual covers do not need metadata lookup"),
  );
  await api.saveBook({
    requestId: "cover_api_save_1",
    book: { ...book, coverUrl: source },
  });
  let volume = (await api.getCollection()).books[0];
  assert.equal(volume.coverId, coverDigest(png));
  assert.deepEqual(covers.get(volume.coverId).body, png);
  await api.saveBook({
    row: volume.row,
    token: volume.token,
    requestId: "cover_api_edit_1",
    book: { ...book, note: "Edited" },
  });
  volume = (await api.getCollection()).books[0];
  assert.equal(volume.coverId, coverDigest(png));
  store.api.removeBook({
    row: volume.row,
    token: volume.token,
    requestId: "cover_api_remove_1",
  });
  const backup = store.exportData();
  const restored = database(t);
  const plan = parseImport(Buffer.from(JSON.stringify(backup)), "backup.json");
  restored.importData(plan, plan.fingerprint);
  const entry = restored.api.getCollection().trash[0];
  assert.equal(entry.book.coverId, volume.coverId);
  const offline = createCoverService(restored, {
    fetchImpl: () => assert.fail("Restores must contain the image"),
  });
  assert.deepEqual(offline.get(entry.book.coverId).body, png);
  assert.equal((await offline.ensure(source)).id, volume.coverId);
  restored.api.restoreBook({
    trashId: entry.id,
    requestId: "cover_api_restore_1",
  });
  assert.equal(restored.api.getCollection().books[0].coverId, volume.coverId);
  const invalid = structuredClone(backup);
  invalid.covers[0].data = Buffer.from("<svg/>").toString("base64");
  assert.throws(
    () => parseImport(Buffer.from(JSON.stringify(invalid)), "backup.json"),
    /stored cover/,
  );
  const missing = structuredClone(backup);
  missing.covers = [];
  assert.throws(
    () => parseImport(Buffer.from(JSON.stringify(missing)), "backup.json"),
    /missing stored cover/,
  );
});

test("failed cover changes preserve the previous choice and clearing a choice removes its ID", async (t) => {
  const store = database(t);
  let fail = false;
  const covers = createCoverService(store, {
    fetchImpl: async () => {
      if (fail) throw new Error("Offline");
      return imageResponse();
    },
  });
  const api = createApplicationApi(store, covers);
  await api.saveBook({
    requestId: "cover_clear_save_1",
    book: { ...book, coverUrl: source },
  });
  const original = store.api.getCollection().books[0];
  fail = true;
  await assert.rejects(
    api.saveBook({
      row: original.row,
      token: original.token,
      requestId: "cover_failed_save_1",
      book: { ...book, coverUrl: "https://du.lnwfile.com/offline.png" },
    }),
    { status: 502 },
  );
  assert.equal(store.api.getCollection().books[0].coverId, original.coverId);
  await api.saveBook({
    row: original.row,
    token: original.token,
    requestId: "cover_clear_save_2",
    book: { ...book, coverUrl: "", coverId: "" },
  });
  assert.equal(store.api.getCollection().books[0].coverId, "");
});

test("automatic IDs persist without becoming manual URLs, do not invalidate edits, and are cleared when the volume changes", async (t) => {
  const store = database(t);
  store.api.saveBook({ requestId: "automatic_cover_save_1", book });
  const original = store.api.getCollection().books[0];
  store.cache.put(volumeCoverKey_(book), source, 86400);
  const covers = createCoverService(store, { fetchImpl: imageResponse });
  const api = createApplicationApi(store, covers);
  const volume = (await api.getCollection()).books[0];
  assert.equal(volume.coverId, coverDigest(png));
  assert.equal(volume.coverUrl, "");
  assert.equal(volume.token, original.token);
  assert.equal(store.api.getCollection().books[0].coverId, volume.coverId);
  await api.saveBook({
    row: volume.row,
    token: original.token,
    requestId: "automatic_cover_save_2",
    book: { ...book, volume: 2, coverId: volume.coverId },
  });
  const changed = store.api.getCollection().books[0];
  assert.equal(changed.coverId, "");
  assert.equal(
    store.covers.assign(changed.row, volume.coverId, original.token),
    "",
  );
});

test("backups restore image payloads larger than a megabyte", (t) => {
  const store = database(t);
  const body = Buffer.concat([png, Buffer.alloc(1100000)]);
  const image = store.covers.put({ body, contentType: "image/png" }, source);
  const plan = parseImport(
    Buffer.from(JSON.stringify(store.exportData())),
    "large-cover.json",
  );
  assert.equal(plan.covers[0].id, image.id);
  assert.deepEqual(plan.covers[0].body, body);
});

test("HTML, SVG, empty images and failed responses are never stored", async (t) => {
  const store = database(t);
  for (const response of [
    () =>
      new Response("<html>Not an image</html>", {
        headers: { "Content-Type": "image/jpeg" },
      }),
    () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    () => new Response(null),
    () => new Response("Unavailable", { status: 503 }),
  ]) {
    await assert.rejects(
      createCoverService(store, { fetchImpl: response }).ensure(source),
      { status: 502 },
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM covers").get().n,
      0,
    );
  }
});

test("cover sources and redirects reject arbitrary hosts, credentials and insecure requests", async (t) => {
  const store = database(t);
  const calls = [];
  let location = "https://127.0.0.1/private";
  const cache = createCoverService(store, {
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
    await assert.rejects(cache.ensure(unsafe), { status: 400 });
  assert.deepEqual(calls, []);
  for (location of [
    "https://127.0.0.1/private",
    "http://www.phoenixnext.com/cover.jpg",
    "https://www.phoenixnext.com:444/cover.jpg",
  ]) {
    const before = calls.length;
    await assert.rejects(cache.ensure(source), { status: 502 });
    assert.equal(calls.length - before, 1);
  }
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM covers").get().n, 0);
});

test("supported image redirects are followed and cached under the original source", async (t) => {
  const store = database(t);
  const calls = [];
  const target = "https://books.googleusercontent.com/cover.png";
  const cache = createCoverService(store, {
    fetchImpl: async (url) => {
      calls.push(url);
      return url === source
        ? new Response(null, { status: 302, headers: { location: target } })
        : imageResponse();
    },
  });
  assert.deepEqual((await cache.ensure(source)).body, png);
  await cache.ensure(source);
  assert.deepEqual(calls, [source, target]);
  let hops = 0;
  await assert.rejects(
    createCoverService(database(t), {
      fetchImpl: async () => {
        hops++;
        return new Response(null, {
          status: 302,
          headers: { location: source },
        });
      },
    }).ensure(source),
    { status: 502 },
  );
  assert.equal(hops, 4);
});

test("cover downloads enforce the size limit for declared and streamed bodies", async (t) => {
  const store = database(t);
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
      createCoverService(store, { fetchImpl: response }).ensure(source),
      { status: 502 },
    );
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM covers").get().n,
      0,
    );
  }
});
