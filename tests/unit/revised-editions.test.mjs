import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isRevisedEditionOf } from "../../lib/domain/title-normalization.ts";
import { parseCatalog } from "../../lib/domain/releases.ts";
import { matchRelease } from "../../lib/client/matching.ts";
import { collectionMissing } from "../../lib/client/missing-catalogs.ts";
import { normalizeRecordTypes } from "../../lib/domain/book-type.ts";

test("explicit revised-edition suffixes identify alternatives without conflating unrelated works", () => {
  const series = "แผนสมรสไม่สมเลิฟ";
  assert.equal(
    isRevisedEditionOf(series + " (ฉบับปรับปรุงใหม่)", series),
    true,
  );
  assert.equal(isRevisedEditionOf(series + " (ฉบับปรับปรุง)", series), true);
  assert.equal(isRevisedEditionOf("Story (REVISED EDITION)", "Story"), true);
  assert.equal(isRevisedEditionOf("Story（Revised Edition）", "Story"), true);
  for (const title of [
    series,
    series + ": After Story (ฉบับปรับปรุงใหม่)",
    "เรื่องอื่น (ฉบับปรับปรุงใหม่)",
    series + " (ฉบับพิเศษ)",
    "Revised Edition Adventures",
  ])
    assert.equal(isRevisedEditionOf(title, series), false, title);
  assert.equal(isRevisedEditionOf("(Revised Edition)", ""), false);
});

test("real Phoenix revised listings stay separate from ownership and missing-volume counts", () => {
  const series = "ดอกรักผลิบานที่กลางใจ";
  const items = parseCatalog(
    "phoenix",
    readFileSync(
      new URL(
        "../fixtures/series-catalogs/phoenix-category.html",
        import.meta.url,
      ),
      "utf8",
    ),
  )
    .filter((item) => isRevisedEditionOf(item.series, series))
    .map((item) =>
      normalizeRecordTypes({
        ...item,
        catalogSeries: series,
        catalogVariant: true,
      }),
    );
  assert.deepEqual(items.map((item) => item.volume).sort(), [1, 2, 3, 4, 5]);
  const books = [
    normalizeRecordTypes({
      series,
      publisher: "PHOENIX Next",
      type: "Manga (TH)",
      volume: 1,
      isbn: "",
    }),
  ];
  for (const item of items) {
    const matches = matchRelease(item, books);
    assert.equal(matches.owned.length, 0);
    assert.equal(matches.possible.length, 0);
  }
  assert.deepEqual(
    collectionMissing(books, [
      { series, publisherId: "phoenix", type: "Manga", feed: { items } },
    ]),
    [],
  );
});
