import test from "node:test";
import assert from "node:assert/strict";
import { seriesPath, seriesFromPath } from "../../lib/domain/navigation.ts";
import { seriesSlug } from "../../lib/domain/series-slug.ts";

const title = "โดนัทของฉันกับพระจันทร์ไม่เต็มดวง";
const oldSegment =
  "4LmC4LiU4LiZ4Lix4LiX4LiC4Lit4LiH4LiJ4Lix4LiZ4LiB4Lix4Lia4Lie4Lij4Liw4LiI4Lix4LiZ4LiX4Lij4LmM4LmE4Lih4LmI4LmA4LiV4LmH4Lih4LiU4Lin4LiH";
const segment = (name) => seriesPath(name).slice("/series/".length);

test("series links use Thai karaoke slugs, not encoded title text", () => {
  assert.equal(
    seriesPath(title),
    "/series/do-nat-khong-chan-kap-phra-chan-mai-tem-duang--13sett0",
  );
  assert.equal(seriesFromPath(segment(title), [title]), title);
  assert.equal(
    seriesSlug("ห้องสมุดใต้แสงจันทร์"),
    "hong-sa-mut-tai-saeng-chan",
  );
  for (const [thai, latin] of [
    ["เต็ม", "tem"],
    ["เด็ก", "dek"],
    ["เป็น", "pen"],
  ])
    assert.equal(seriesSlug(thai), latin);
});

test("slugs preserve mixed-script Latin text and numbers while removing URL syntax", () => {
  for (const [name, slug] of [
    ["My / Books 100% ? #", "my-books-100"],
    ["เรื่องTest ๑๒๓", "rueang-test-123"],
    ["Testเรื่อง", "test-rueang"],
    ["ไทย１２３", "thai-123"],
    ["Café & Books", "cafe-books"],
  ]) {
    assert.equal(seriesSlug(name), slug);
    assert.equal(seriesFromPath(segment(name), [name]), name);
  }
});

test("similar karaoke spellings and punctuation-only titles remain distinct", () => {
  const names = ["ขา", "ค่า", "My Books", "my-books", "😀", "😃", "\u0000\r\n"];
  assert.equal(seriesSlug(names[0]), seriesSlug(names[1]));
  assert.equal(new Set(names.map(seriesPath)).size, names.length);
  for (const name of names) {
    assert.match(seriesPath(name), /^\/series\/[a-z0-9-]+$/);
    assert.equal(seriesFromPath(segment(name), names), name);
  }
  assert.equal(seriesSlug("😀"), "series");
  assert.equal(seriesSlug("a".repeat(500)).length, 96);
});

test("legacy bookmarks and outdated readable prefixes resolve to the original title", () => {
  assert.equal(seriesFromPath(oldSegment, [title]), title);
  const outdated = segment(title).replace(/^.*--/, "old-spelling--");
  assert.equal(seriesFromPath(outdated, [title]), title);
  // Duplicate candidates can come from books, dropdown options and catalogs.
  assert.equal(seriesFromPath(segment(title), [title, title]), title);
});

test("URLs only resolve against the supplied account's titles", () => {
  assert.throws(() => seriesFromPath(segment(title), ["Another account"]));
  assert.throws(() => seriesFromPath(oldSegment, ["Another account"]));
  for (const invalid of [
    "",
    "../data",
    "%2F",
    "a?b",
    "a#b",
    "_w",
    "a",
    "YWJj=",
  ])
    assert.throws(() => seriesFromPath(invalid, [title]));
  // Reject a noncanonical base64 alias rather than redirecting arbitrary bytes.
  assert.throws(() => seriesFromPath("YR", ["a"]));
});
