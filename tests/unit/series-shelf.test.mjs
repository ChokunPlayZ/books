import test from "node:test";
import assert from "node:assert/strict";
import { missingShelfVolumes } from "../../lib/client/series-shelf.ts";

const book = (volume, extra = {}) => ({
  series: "Shelf story",
  type: "Manga",
  edition: "(EN)",
  publisher: "Test Press",
  volume,
  isbn: "",
  ...extra,
});
const known = (volume, extra = {}) => ({
  ...book(volume),
  key: "catalog-" + volume,
  title: "Shelf story Vol. " + volume,
  language: "en",
  owned: false,
  url: "https://example.com/volume-" + volume,
  ...extra,
});

test("one missing slot combines shelf gaps and catalog covers without duplicating owned volumes or alternate listings", () => {
  const owned = [book(1), book(3), book(3)];
  const missing = missingShelfVolumes(
    owned,
    [
      known(1),
      known(2, { coverId: "cover-two", listedPrice: 175, source: "Publisher" }),
      known(3),
      known(4),
      known(4, { key: "catalog-alternate-four", coverId: "cover-four" }),
    ],
    [],
  );
  assert.deepEqual(
    missing.map(({ book }) => book.volume),
    [2, 4],
  );
  assert.equal(missing[0].book.coverId, "cover-two");
  assert.equal(missing[0].book.price, "");
  assert.equal(missing[0].book.source, "");
  assert.equal(missing[0].catalog.price, 175);
  assert.equal(missing[1].book.coverId, "cover-four");
  assert.equal(missing[0].detailKey, "catalog-2");
  assert.deepEqual(
    missingShelfVolumes([...owned, book(2), book(4)], [known(2), known(4)], []),
    [],
  );
});

test("ownership and inferred gaps stay separate by language, format and publisher", () => {
  const missing = missingShelfVolumes(
    [book(2), book(1, { edition: "(JP)" }), book(1, { type: "Light novel" })],
    [
      known(2, { edition: "(JP)", language: "ja" }),
      known(3, { type: "Light novel" }),
      known(4, { publisher: "Other Press" }),
      known(4, { edition: "(TH)", language: "th" }),
    ],
    [],
  );
  assert.deepEqual(
    missing.map(({ book }) => [book.type, book.edition, book.volume]),
    [
      ["Manga", "Manga (EN)", 1],
      ["Manga", "(JP)", 2],
      ["Light novel", "(EN)", 3],
    ],
  );
});

test("known catalog language can reuse an unmarked edition and ISBN matches do not create false missing books", () => {
  const owned = [book(1, { edition: "", isbn: "9780140328721" })];
  const missing = missingShelfVolumes(
    owned,
    [known(1, { edition: "", isbn: "0140328726" }), known(2, { edition: "" })],
    [],
  );
  assert.deepEqual(
    missing.map(({ book }) => book.volume),
    [2],
  );
  assert.equal(missing[0].book.edition, "");
});

test("large inferred ranges stay bounded and split around real catalog volumes", () => {
  const missing = missingShelfVolumes([book(1000000)], [known(500000)], []);
  assert.deepEqual(
    missing.map(({ book, rangeEnd }) => [book.volume, rangeEnd]),
    [
      [1, 499999],
      [500000, undefined],
      [500001, 999999],
    ],
  );
  assert.deepEqual(missingShelfVolumes([book("")], [], []), []);
  assert.deepEqual(
    missingShelfVolumes([book(0), book(1), book(1.5)], [], []),
    [],
  );
});
