import assert from "node:assert/strict";

const url = process.env.BOOKS_TEST_URL;
assert.ok(url, "Set BOOKS_TEST_URL to an isolated production test server");

for (const path of [
  "/icons/icon-512.png",
  "/icons/%69con-512.png",
  "/icons/audit-cache-bust/../icon-512.png",
  "/api/health",
]) {
  const query = new URLSearchParams({ url: path, w: "640", q: "75" });
  const response = await fetch(`${url}/_next/image?${query}`, {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 404, `The optimizer must not process ${path}`);
  assert.equal(response.headers.get("x-nextjs-cache"), null);
  await response.arrayBuffer();
}

const icon = await fetch(`${url}/icons/icon-512.png`, {
  signal: AbortSignal.timeout(10000),
});
assert.equal(icon.status, 200, "The PWA icon must remain publicly available");
assert.match(icon.headers.get("content-type"), /^image\/png/);
await icon.arrayBuffer();
console.log(
  "PASS disabled public optimizer and unchanged static image delivery",
);
