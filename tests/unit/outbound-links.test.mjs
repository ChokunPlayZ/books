import assert from "node:assert/strict";
import test from "node:test";
import {
  outboundUrl,
  OUTBOUND_LINK_ATTRIBUTES,
} from "../../lib/domain/outbound-links.ts";

test("external HTTP(S) links identify meemai as the traffic source", () => {
  for (const protocol of ["https:", "http:"])
    assert.equal(
      outboundUrl(`${protocol}//example.com/books/123`),
      `${protocol}//example.com/books/123?ref=meemai.ckl.moe`,
    );
  assert.equal(
    outboundUrl("//example.com/books/123"),
    "https://example.com/books/123?ref=meemai.ckl.moe",
  );
});

test("attribution preserves destination parameters, Unicode and fragments", () => {
  const raw =
    "https://example.com/search?q=มีมั้ย%20books&pid=42&tag=a&tag=b#publications";
  const before = new URL(raw);
  const after = new URL(outboundUrl(raw));
  assert.equal(after.origin, before.origin);
  assert.equal(after.pathname, before.pathname);
  assert.equal(after.hash, before.hash);
  assert.equal(after.searchParams.get("ref"), "meemai.ckl.moe");
  after.searchParams.delete("ref");
  assert.deepEqual([...after.searchParams], [...before.searchParams]);
});

test("attribution replaces old ref values and is idempotent", () => {
  const raw = "https://example.com/book?ref=other&pid=42&ref=duplicate#buy";
  const attributed = outboundUrl(raw);
  assert.equal(
    attributed,
    "https://example.com/book?ref=meemai.ckl.moe&pid=42#buy",
  );
  assert.equal(outboundUrl(attributed), attributed);
});

test("internal navigation, downloads and non-web links remain untouched", () => {
  for (const raw of [
    "",
    "/",
    "/series/My%20books?view=list#volume-2",
    "/api/backup?series=My%20books",
    "?q=books",
    "#libraryMain",
    "https://meemai.ckl.moe/prices?isbn=9780385496490",
    "//meemai.ckl.moe/privacy",
    "mailto:chokunplayz@ckl.moe",
    "tel:+66000000000",
    "blob:https://meemai.ckl.moe/download",
    "https://[invalid",
  ])
    assert.equal(outboundUrl(raw), raw);
});

test("external links isolate tabs without suppressing origin-only referrers", () => {
  assert.equal(OUTBOUND_LINK_ATTRIBUTES.rel, "noopener");
  assert.equal(
    OUTBOUND_LINK_ATTRIBUTES.referrerPolicy,
    "strict-origin-when-cross-origin",
  );
});
