import test from "node:test";
import assert from "node:assert/strict";
import {
  fieldLabel,
  readableText,
  recordDate,
  recordFields,
  recordImage,
  recordTitle,
  safeRecordLink,
  unpackRecord,
} from "../../lib/admin-presentation.ts";
import { cachePreviewData } from "../../lib/server/cache-preview.ts";

test("record presentation unpacks saved records, labels fields and preserves text", () => {
  const row = {
    id: "release-1",
    user_id: 3,
    data: JSON.stringify({
      title: "A real title",
      coverId: "a".repeat(64),
      note: "First line\nSecond line",
    }),
  };
  assert.equal(recordTitle(row), "A real title");
  assert.equal(recordFields(row).note, "First line\nSecond line");
  assert.equal(recordFields(row).user_id, 3);
  assert.deepEqual(
    recordFields({
      id: "receipt",
      data: JSON.stringify({
        id: "book",
        data: { note: "Nested data stays visible" },
      }),
    }),
    {
      id: "receipt",
      data: { note: "Nested data stays visible" },
      stored_data: { id: "book" },
    },
  );
  assert.equal(fieldLabel("cover_url"), "Cover image");
  assert.equal(fieldLabel("checkedAt"), "Checked at");
  assert.equal(fieldLabel("page_count"), "Page count");
  assert.deepEqual(unpackRecord('["one","two"]'), ["one", "two"]);
  assert.equal(unpackRecord("{unfinished"), "{unfinished");
  assert.equal(
    readableText("First line\nSecond line < 3"),
    "First line\nSecond line < 3",
  );
  assert.equal(
    recordDate(1735689600000, "checkedAt"),
    "2025-01-01T00:00:00.000Z",
  );
  assert.equal(recordDate("invalid", "created_at"), "");
  assert.equal(recordDate(12345, "isbn"), "");
});

test("pictures use stored-cover inspection or trusted image hosts; links reject executable schemes", () => {
  assert.equal(
    recordImage("a".repeat(64), "cover_id"),
    `/api/covers/${"a".repeat(64)}?inspection=1`,
  );
  assert.equal(
    recordImage("https://images.yenpress.com/cover.jpg", "coverUrl"),
    "https://images.yenpress.com/cover.jpg",
  );
  assert.equal(
    recordImage("https://tracker.example/pixel.png", "coverUrl"),
    "",
  );
  assert.equal(recordImage("javascript:alert(1)", "image"), "");
  assert.equal(
    safeRecordLink("text:https://yenpress.com/series/example"),
    "https://yenpress.com/series/example",
  );
  for (const unsafe of [
    "javascript:alert(1)",
    "data:text/html,<script>x</script>",
    "https://user:secret@example.com/",
  ])
    assert.equal(safeRecordLink(unsafe), "");
});

test("scraped HTML becomes readable text without scripts, style or embedded resources", () => {
  assert.equal(
    readableText(
      '<h1>A &amp; B</h1><p>First paragraph</p><p>Second<br>line</p><script>window.xss=true</script><style>body{display:none}</style><img src="https://tracker.example/pixel">',
    ),
    "A & B\n\nFirst paragraph\n\nSecond\nline",
  );
  assert.equal(
    readableText("<p>&lt;script&gt;not executable&lt;/script&gt;</p>"),
    "<script>not executable</script>",
  );
  assert.equal(
    readableText("<!-- hidden -->Visible<script>unfinished"),
    "Visible",
  );
});

test("bounded cache windows retain object fields and array entries instead of broken JSON", () => {
  const data = {
    found: true,
    count: 0,
    optional: null,
    items: [
      { title: "First" },
      { title: "Second", body: "x".repeat(24000) },
      { title: "Last" },
    ],
  };
  const formatted = JSON.stringify(data, null, 2);
  assert.deepEqual(cachePreviewData(data, 0, formatted.length), data);
  const tail = cachePreviewData(data, formatted.indexOf('"Last"'));
  assert.deepEqual(tail, { items: [{ title: "Last" }] });
  const middle = cachePreviewData(
    data,
    formatted.indexOf("x".repeat(100)) + 100,
    1000,
  );
  assert.deepEqual(middle, { items: [{ body: "x".repeat(1000) }] });
  const escaped = { note: 'a"\n\\😀ไทย'.repeat(1000) };
  const full = JSON.stringify(escaped, null, 2);
  assert.deepEqual(cachePreviewData(escaped, 0, full.length), escaped);
  const window = cachePreviewData(escaped, full.indexOf("😀"), 2);
  assert.equal(window.note, "😀");
  assert.deepEqual(cachePreviewData({ empty: [], no: false }, 0), {
    empty: [],
    no: false,
  });
});
