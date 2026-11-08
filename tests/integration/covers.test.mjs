import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCoverService, coverDigest } from "../../lib/server/covers.ts";
import { openTestStore as openStore } from "../helpers/database.mjs";
import { createApplicationApi } from "../../lib/server/api.ts";
import { parseImport } from "../../lib/server/importer.ts";
import { releaseItem, volumeCoverKey } from "../../lib/domain.ts";
import sharp from "sharp";
import { attachCoverPlaceholders } from "../../lib/server/covers.ts";
import { createAccount } from "../../lib/server/auth.ts";

const source = "https://www.phoenixnext.com/media/catalog/product/cover.jpg";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const imageResponse = () =>
  new Response(png, { headers: { "Content-Type": "image/png" } });
async function database(t) {
  const store = await openStore();
  t.after(async () => await store.close());
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

test("WebP previews and BlurHashes persist independently of original IDs, bytes and backups", async (t) => {
  const path = join(await directory(t), "previews");
  let store = await openStore(path);
  t.after(() => store.close());
  const original = await sharp({
    create: { width: 800, height: 1200, channels: 3, background: "#639057" },
  })
    .png()
    .toBuffer();
  let calls = 0;
  let covers = createCoverService(store, {
    fetchImpl: async () => {
      calls++;
      return new Response(original);
    },
  });
  const image = await covers.ensure(source);
  assert.equal(image.id, coverDigest(original));
  assert.deepEqual(image.body, original);
  await store.api.saveBook({
    requestId: "webp_preview_save_1",
    book: { ...book, coverId: image.id },
  });
  const before = (await store.api.getCollection()).books[0];
  const optimized = await covers.get(image.id, true);
  assert.equal(optimized.contentType, "image/webp");
  assert.equal(optimized.etag, '"' + coverDigest(optimized.body) + '"');
  assert.notEqual(optimized.etag, '"' + image.id + '"');
  assert.equal((await sharp(optimized.body).metadata()).height, 740);
  const api = createApplicationApi(store, covers);
  const after = (await api.getCollection()).books[0];
  assert.equal(after.token, before.token);
  assert.equal(after.coverBlurhash.length, 36);
  assert.equal(calls, 1);
  const backup = await store.exportData();
  assert.deepEqual(Buffer.from(backup.covers[0].data, "base64"), original);

  await store.close();
  store = await openStore(path);
  covers = createCoverService(store, {
    fetchImpl: () => assert.fail("Previews must work offline"),
  });
  assert.deepEqual((await covers.get(image.id, true)).body, optimized.body);
  assert.equal((await covers.ensure(source)).id, image.id);
  assert.deepEqual((await covers.get(image.id)).body, original);

  const restored = await database(t);
  const plan = parseImport(Buffer.from(JSON.stringify(backup)), "backup.json");
  await restored.importData(plan, plan.fingerprint);
  const offline = createCoverService(restored, {
    fetchImpl: () =>
      assert.fail("Restored originals regenerate previews offline"),
  });
  assert.deepEqual((await offline.get(image.id, true)).body, optimized.body);
});

test("legacy images optimize lazily, versioned previews rebuild, and placeholder metadata stays private", async (t) => {
  const store = await database(t);
  const original = await sharp({
    create: { width: 80, height: 120, channels: 3, background: "#cc8855" },
  })
    .png()
    .toBuffer();
  const image = await store.covers.put({
    body: original,
    contentType: "image/png",
  });
  assert.equal(await store.covers.preview(image.id), null);
  const covers = createCoverService(store, {
    fetchImpl: () => assert.fail("No network needed for legacy originals"),
  });
  const results = await Promise.all(
    Array.from({ length: 8 }, () => covers.get(image.id, true)),
  );
  assert.ok(results.every((result) => result.contentType === "image/webp"));
  const record = await attachCoverPlaceholders(store, {
    coverId: image.id,
    coverBlurhash: "untrusted",
  });
  assert.equal(record.coverBlurhash.length, 36);
  await store.db
    .prepare(
      "UPDATE cover_previews SET version=0,body=NULL,blurhash='' WHERE cover_id=?",
    )
    .run(image.id);
  assert.deepEqual((await covers.get(image.id, true)).body, results[0].body);
  assert.equal(
    (await store.covers.preview(image.id)).blurhash,
    record.coverBlurhash,
  );
  const other = await createAccount(store, "other", "other@gmail.com");
  await store.forUser(other, async () => {
    assert.equal(await store.covers.canAccess(image.id), false);
    const hidden = await attachCoverPlaceholders(store, {
      coverId: image.id,
      coverBlurhash: "untrusted",
    });
    assert.equal(hidden.coverBlurhash, undefined);
  });
});

test("undecodable legacy images retain their original response and cache conversion failures", async (t) => {
  const store = await database(t);
  const image = await store.covers.put({ body: png, contentType: "image/png" });
  const covers = createCoverService(store);
  assert.deepEqual((await covers.get(image.id, true)).body, png);
  assert.deepEqual(await store.covers.preview(image.id), {
    body: null,
    blurhash: "",
  });
  assert.equal((await covers.get(image.id, true)).contentType, "image/png");
  assert.equal((await covers.get(image.id, true)).etag, '"' + image.id + '"');
});

test("image bytes live in PostgreSQL, concurrent downloads deduplicate, and IDs survive restarts and source outages", async (t) => {
  const path = join(await directory(t), "library.sqlite");
  let store = await openStore(path);
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
  assert.equal(
    (await store.db.prepare("SELECT COUNT(*) AS n FROM covers").get()).n,
    1,
  );
  assert.deepEqual(
    Buffer.from(
      (await store.db.prepare("SELECT body FROM covers WHERE id=?").get(id))
        .body,
    ),
    png,
  );
  await assert.rejects(
    async () => await covers.get("https://127.0.0.1/private"),
    { status: 400 },
  );
  await assert.rejects(async () => await covers.get("0".repeat(64)), {
    status: 404,
  });
  await store.close();
  store = await openStore(path);
  t.after(async () => await store.close());
  const restarted = createCoverService(store, {
    fetchImpl: () => assert.fail("Stored images must not use the network"),
  });
  assert.deepEqual((await restarted.get(id)).body, png);
  assert.equal((await restarted.get(id)).etag, '"' + id + '"');
  assert.equal((await restarted.ensure(source)).id, id);
});

test("content IDs deduplicate different sources and old file caches migrate without a download", async (t) => {
  const store = await database(t);
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
  assert.equal(
    (await store.db.prepare("SELECT COUNT(*) AS n FROM covers").get()).n,
    1,
  );
  assert.equal(
    (await store.db.prepare("SELECT COUNT(*) AS n FROM cover_sources").get()).n,
    2,
  );
});

test("cached releases do not retry failed covers on every view or restart, and recover after the cooldown", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const legacyDirectory = await directory(t);
  const path = join(legacyDirectory, "library.sqlite");
  let store = await openStore(path);
  t.after(async () => await store.close());
  const checkedAt = new Date().toISOString();
  await store.cache.put(
    "releases:v1:phoenix",
    JSON.stringify({
      publisherId: "phoenix",
      items: [
        {
          ...releaseItem(
            "phoenix",
            "Cached release เล่ม 1",
            "https://www.phoenixnext.com/cached-release.html",
            100,
            "",
            "Manga (TH)",
          ),
          coverUrl: source,
        },
      ],
      checkedAt,
      stale: false,
      error: "",
    }),
    30 * 86400,
  );
  let imageCalls = 0,
    catalogCalls = 0,
    offline = true;
  const application = () =>
    createApplicationApi(
      store,
      createCoverService(store, {
        legacyDirectory,
        fetchImpl: async () => {
          imageCalls++;
          return offline
            ? new Response("Unavailable", { status: 503 })
            : imageResponse();
        },
      }),
      async () => {
        catalogCalls++;
        throw new Error("Cached releases should not fetch catalog pages");
      },
    );
  let api = application();
  const request = { publisherId: "phoenix" };
  const results = await Promise.all(
    Array.from({ length: 8 }, () => api.getPublisherReleases(request)),
  );
  assert.equal(imageCalls, 1, "Concurrent failures share one download");
  assert.ok(
    results.every(
      (result) =>
        result.items.length === 1 &&
        !result.items[0].coverId &&
        result.checkedAt === checkedAt &&
        !result.stale,
    ),
    "Failed covers must not discard cached releases",
  );
  await api.getPublisherReleases(request);
  assert.equal(
    imageCalls,
    1,
    "Reopening cached releases respects the cooldown",
  );

  await store.close();
  store = await openStore(path);
  api = application();
  t.mock.timers.tick(15 * 60000 - 1);
  await api.getPublisherReleases(request);
  assert.equal(imageCalls, 1, "The cooldown survives a database restart");

  offline = false;
  t.mock.timers.tick(1);
  const recovered = await api.getPublisherReleases(request);
  assert.equal(imageCalls, 2, "Failed images are retried after 15 minutes");
  assert.equal(recovered.items[0].coverId, coverDigest(png));
  assert.equal(recovered.checkedAt, checkedAt);

  await store.close();
  store = await openStore(path);
  const cached = await application().getPublisherReleases(request);
  assert.equal(cached.items[0].coverId, coverDigest(png));
  assert.equal(
    imageCalls,
    2,
    "Successful covers remain stored across restarts",
  );
  assert.equal(catalogCalls, 0, "All release views reuse the catalog cache");
});

test("API choices, saved volumes, trash and JSON restore retain stored cover IDs and bytes offline", async (t) => {
  const store = await database(t);
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
  assert.deepEqual((await covers.get(volume.coverId)).body, png);
  await api.saveBook({
    row: volume.row,
    token: volume.token,
    requestId: "cover_api_edit_1",
    book: { ...book, note: "Edited" },
  });
  volume = (await api.getCollection()).books[0];
  assert.equal(volume.coverId, coverDigest(png));
  await store.api.removeBook({
    row: volume.row,
    token: volume.token,
    requestId: "cover_api_remove_1",
  });
  const backup = await store.exportData();
  const restored = await database(t);
  const plan = parseImport(Buffer.from(JSON.stringify(backup)), "backup.json");
  await restored.importData(plan, plan.fingerprint);
  const entry = (await restored.api.getCollection()).trash[0];
  assert.equal(entry.book.coverId, volume.coverId);
  const offline = createCoverService(restored, {
    fetchImpl: () => assert.fail("Restores must contain the image"),
  });
  assert.deepEqual((await offline.get(entry.book.coverId)).body, png);
  assert.equal((await offline.ensure(source)).id, volume.coverId);
  await restored.api.restoreBook({
    trashId: entry.id,
    requestId: "cover_api_restore_1",
  });
  assert.equal(
    (await restored.api.getCollection()).books[0].coverId,
    volume.coverId,
  );
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
  const store = await database(t);
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
  const original = (await store.api.getCollection()).books[0];
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
  assert.equal(
    (await store.api.getCollection()).books[0].coverId,
    original.coverId,
  );
  await api.saveBook({
    row: original.row,
    token: original.token,
    requestId: "cover_clear_save_2",
    book: { ...book, coverUrl: "", coverId: "" },
  });
  assert.equal((await store.api.getCollection()).books[0].coverId, "");
});

test("automatic IDs persist without becoming manual URLs, do not invalidate edits, and are cleared when the volume changes", async (t) => {
  const store = await database(t);
  await store.api.saveBook({ requestId: "automatic_cover_save_1", book });
  const original = (await store.api.getCollection()).books[0];
  await store.cache.put(volumeCoverKey(book), source, 86400);
  const covers = createCoverService(store, { fetchImpl: imageResponse });
  const api = createApplicationApi(store, covers);
  const volume = (await api.getCollection()).books[0];
  assert.equal(volume.coverId, coverDigest(png));
  assert.equal(volume.coverUrl, "");
  assert.equal(volume.token, original.token);
  assert.equal(
    (await store.api.getCollection()).books[0].coverId,
    volume.coverId,
  );
  await api.saveBook({
    row: volume.row,
    token: original.token,
    requestId: "automatic_cover_save_2",
    book: { ...book, volume: 2, coverId: volume.coverId },
  });
  const changed = (await store.api.getCollection()).books[0];
  assert.equal(changed.coverId, "");
  assert.equal(
    await store.covers.assign(changed.row, volume.coverId, original.token),
    "",
  );
});

test("backups restore image payloads larger than a megabyte", async (t) => {
  const store = await database(t);
  const body = Buffer.concat([png, Buffer.alloc(1100000)]);
  const image = await store.covers.put(
    { body, contentType: "image/png" },
    source,
  );
  await store.api.saveBook({
    requestId: "large_image_book_001",
    book: { ...book, coverId: image.id },
  });
  const plan = parseImport(
    Buffer.from(JSON.stringify(await store.exportData())),
    "large-cover.json",
  );
  assert.equal(plan.covers[0].id, image.id);
  assert.deepEqual(plan.covers[0].body, body);
});

test("HTML, SVG, empty images and failed responses are never stored", async (t) => {
  for (const response of [
    () =>
      new Response("<html>Not an image</html>", {
        headers: { "Content-Type": "image/jpeg" },
      }),
    () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    () => new Response(null),
    () => new Response("Unavailable", { status: 503 }),
  ]) {
    const store = await database(t);
    await assert.rejects(
      createCoverService(store, { fetchImpl: response }).ensure(source),
      { status: 502 },
    );
    assert.equal(
      (await store.db.prepare("SELECT COUNT(*) AS n FROM covers").get()).n,
      0,
    );
  }
});

test("cover sources and redirects reject arbitrary hosts, credentials and insecure requests", async (t) => {
  const store = await database(t);
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
    const redirected = createCoverService(await database(t), {
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response(null, { status: 302, headers: { location } });
      },
    });
    await assert.rejects(redirected.ensure(source), { status: 502 });
    assert.equal(calls.length - before, 1);
  }
  assert.equal(
    (await store.db.prepare("SELECT COUNT(*) AS n FROM covers").get()).n,
    0,
  );
});

test("supported image redirects are followed and cached under the original source", async (t) => {
  const store = await database(t);
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
    createCoverService(await database(t), {
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
  const limit = 5 * 1024 * 1024;
  for (const response of [
    () =>
      new Response(png, { headers: { "Content-Length": String(limit + 1) } }),
    () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(png);
            controller.enqueue(new Uint8Array(limit));
            await controller.close();
          },
        }),
      ),
  ]) {
    const store = await database(t);
    await assert.rejects(
      createCoverService(store, { fetchImpl: response }).ensure(source),
      { status: 502 },
    );
    assert.equal(
      (await store.db.prepare("SELECT COUNT(*) AS n FROM covers").get()).n,
      0,
    );
  }
});
