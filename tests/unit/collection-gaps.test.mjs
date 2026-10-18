import test from "node:test";
import assert from "node:assert/strict";
import { collectionGaps, missingSummary } from "../../lib/client/matching.ts";

const book = (series, volume, extra = {}) => ({
  series,
  volume,
  type: "Manga (TH)",
  publisher: "PHOENIX Next",
  isbn: "",
  ...extra,
});

test("collection gaps group titles while preserving publisher, language and format boundaries", () => {
  const books = [
    book(" Z story ", 1, { type: "Manga (TH) (Color)" }),
    book("Z story", 3, { publisher: "Phoenix Next" }),
    book("Z story", 3),
    book("Z story", 3.5),
    book("Z story", 1, { type: "Manga (JP)" }),
    book("Z story", 3, { type: "Manga (JP)" }),
    book("Z story", 3, { type: "LN (TH)" }),
    book("Z story", 1, { publisher: "Kodansha" }),
    book("Z story", 3, { publisher: "Kodansha" }),
    book("A story", 4),
    book("Complete story", 1),
    book("Complete story", 2),
    book("Unnumbered story", ""),
  ];
  const original = structuredClone(books);
  const groups = collectionGaps(books);
  assert.deepEqual(
    groups.map(({ series, missing }) => ({ series, missing })),
    [
      { series: "A story", missing: 3 },
      { series: "Z story", missing: 5 },
    ],
  );
  assert.deepEqual(
    groups[1].editions.map(({ ranges }) => ranges),
    [[[2, 2]], [[2, 2]], [[1, 2]], [[2, 2]]],
  );
  assert.equal(missingSummary(groups), "8 missing volumes across 2 series");
  assert.deepEqual(books, original);
});

test("gaps stay bounded as ranges and do not invent extra or future volumes", () => {
  const groups = collectionGaps([
    book("Large sequence", 1000000),
    book("Fractional extra", 0.5),
    book("No sequence", 0),
    book("Up to date", 1),
    book("Up to date", 2),
    book("Up to date", 2.5),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].missing, 999999);
  assert.deepEqual(groups[0].editions[0].ranges, [[1, 999999]]);
  assert.deepEqual(collectionGaps([]), []);
  assert.equal(missingSummary([]), "0 missing volumes across 0 series");
  assert.equal(
    missingSummary([{ missing: 1 }]),
    "1 missing volume across 1 series",
  );
});
