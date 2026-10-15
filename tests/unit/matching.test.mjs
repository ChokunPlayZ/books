import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { releaseItem, parseCatalog } from "../../lib/domain.ts";

import {
  seriesGaps,
  matchRelease,
  releaseSingleVolume,
} from "../../lib/client/matching.ts";
function matching(books) {
  return {
    seriesGaps,
    releaseSingleVolume,
    releaseMatches: (item) => matchRelease(item, books),
  };
}
const shelf = {
  series: "เรื่องหนึ่ง",
  publisher: "PHOENIX Next",
  type: "Manga (TH)",
  volume: 5,
  isbn: "",
};
const item = (title = "(มังงะ) เรื่องหนึ่ง เล่ม 5", type = "Manga (TH)") =>
  releaseItem(
    "phoenix",
    title,
    "https://www.phoenixnext.com/matching-5.html",
    175,
    "",
    type,
  );

test("owning either a regular or special volume covers its other listings, including older saved titles", () => {
  const special = item("(มังงะ) Special Set B เรื่องหนึ่ง เล่ม 5");
  assert.equal(special.series, shelf.series);
  assert.equal(special.special, true);
  assert.equal(special.bundle, false);
  assert.equal(matching([shelf]).releaseMatches(special).possible.length, 1);
  assert.equal(
    matching([
      { ...shelf, series: "Special Set B เรื่องหนึ่ง" },
    ]).releaseMatches(item()).possible.length,
    1,
  );
  const saved = {
    ...special,
    series: "Special Set B เรื่องหนึ่ง",
    catalogSeries: shelf.series,
    catalogVariant: true,
  };
  assert.equal(matching([shelf]).releaseMatches(saved).possible.length, 1);
});

test("color is a manga attribute for gaps and ownership while language, format and publisher still matter", () => {
  const books = [1, 2, 3, 4, 5].map((volume) => ({
    ...shelf,
    volume,
    type: volume < 5 ? "Manga (TH) (Color)" : shelf.type,
  }));
  const h = matching(books);
  const gaps = h.seriesGaps(books);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].missing, 0);
  assert.equal(gaps[0].highest, 5);
  assert.equal(
    h.releaseMatches(item("(มังงะ) เรื่องหนึ่ง เล่ม 2")).possible.length,
    1,
  );
  assert.equal(
    h.releaseMatches(item(undefined, "Manga (TH) (Color)")).possible.length,
    1,
  );
  assert.equal(
    h.releaseMatches(item(undefined, "Manga (JP) (Color)")).possible.length,
    0,
  );
  assert.equal(h.releaseMatches(item(undefined, "LN (TH)")).possible.length, 0);
  assert.equal(
    matching([{ ...shelf, publisher: "Luckpim" }]).releaseMatches(item())
      .possible.length,
    0,
  );
  assert.equal(books[0].type, "Manga (TH) (Color)");
});

test("real Phoenix single-volume editions match while multi-volume sets and revised editions need review", () => {
  const items = parseCatalog(
    "phoenix",
    readFileSync(
      new URL(
        "../fixtures/series-catalogs/phoenix-category.html",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const h = matching([
    { ...shelf, series: "ดอกรักผลิบานที่กลางใจ", volume: 22 },
  ]);
  const volume22 = items.filter((entry) => entry.volume === 22);
  assert.equal(volume22.length, 5);
  assert.ok(
    volume22.every((entry) => h.releaseMatches(entry).possible.length === 1),
  );
  const bundle = items.find((entry) => entry.title.includes("เล่ม 19-20"));
  assert.equal(bundle.bundle, true);
  assert.equal(
    matching([{ ...shelf, series: bundle.series, volume: 19 }]).releaseMatches(
      bundle,
    ).possible.length,
    0,
  );
  assert.equal(
    h.releaseSingleVolume(item("(มังงะ) Box Set เรื่องหนึ่ง เล่ม 5")),
    false,
  );
  assert.equal(
    h.releaseSingleVolume({
      ...item(),
      title: "Special Set เรื่องหนึ่ง",
      special: true,
    }),
    false,
  );
  const revised = {
    ...items.find((entry) => entry.title.includes("ฉบับปรับปรุงใหม่")),
    catalogSeries: "ดอกรักผลิบานที่กลางใจ",
    catalogVariant: true,
  };
  assert.equal(
    matching([
      { ...shelf, series: revised.catalogSeries, volume: revised.volume },
    ]).releaseMatches(revised).possible.length,
    0,
  );
});
