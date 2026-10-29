import test from "node:test";
import assert from "node:assert/strict";
import {
  collectionMissing,
  missingCatalogSpecs,
} from "../../lib/client/missing-catalogs.ts";

const book = (volume, extra = {}) => ({
  series: "A story",
  publisher: "PHOENIX Next",
  type: "Manga (TH)",
  volume,
  isbn: "",
  ...extra,
});
const item = (volume, extra = {}) => ({
  id: "volume-" + volume,
  publisherId: "phoenix",
  publisher: "PHOENIX Next",
  series: "A story",
  type: "Manga (TH)",
  volume,
  title: `A story เล่ม ${volume}`,
  url: `https://www.phoenixnext.com/story-${volume}.html`,
  isbn: "",
  price: 175,
  special: false,
  bundle: false,
  availability: "",
  ...extra,
});
const catalog = (items, extra = {}) => ({
  series: "A story",
  publisherId: "phoenix",
  type: "Manga (TH)",
  feed: { items, complete: true },
  ...extra,
});

test("unowned catalog volumes appear even when every owned volume is consecutive", () => {
  const result = collectionMissing(
    [book(1), book(2)],
    [catalog([1, 2, 3, 4].map((volume) => item(volume)))],
  );
  assert.equal(result[0].missing, 2);
  assert.deepEqual(
    result[0].editions[0].catalogVolumes.map(({ item }) => item.volume),
    [3, 4],
  );
});

test("catalog listings and shelf gaps count each volume once, including decimal volumes and alternate editions", () => {
  const result = collectionMissing(
    [book(1), book(4)],
    [
      catalog([
        item(2),
        item(3),
        item(5, { special: true, id: "special-5" }),
        item(5),
        item(5.5),
      ]),
    ],
  );
  const edition = result[0].editions[0];
  assert.equal(result[0].missing, 4);
  assert.deepEqual(edition.ranges, []);
  assert.deepEqual(
    edition.catalogVolumes.map(({ item }) => item.volume),
    [2, 3, 5, 5.5],
  );
  assert.equal(edition.catalogVolumes[2].item.special, false);
  assert.equal(edition.catalogVolumes[2].alternatives.length, 1);
});

test("whole-volume coverage combines colored manga but keeps languages, formats, publishers and uncertain sets separate", () => {
  const result = collectionMissing(
    [book(1, { type: "Manga (TH) (Color)" }), book(2)],
    [
      catalog([
        item(1),
        item(2),
        item(3),
        item(4, { type: "Manga (JP)" }),
        item(5, { type: "LN (TH)" }),
        item(6, { publisherId: "firstpage" }),
        item(7, { bundle: true }),
        item(8, { catalogVariant: true }),
        item(9, { type: "" }),
      ]),
    ],
  );
  assert.equal(result[0].missing, 1);
  assert.equal(result[0].editions[0].catalogVolumes[0].item.volume, 3);
  assert.equal(
    collectionMissing(
      [book(3, { publisher: "Kodansha" })],
      [catalog([item(4)])],
    )[0].missing,
    2,
  );
});

test("exact ISBN ownership suppresses alternate listings and fills inferred gaps even without a recorded volume", () => {
  const books = [book(1), book(4), book("", { isbn: "0140328726" })];
  for (const items of [
    [
      item(3, { isbn: "9780140328721" }),
      item(3, { id: "other-3", special: true }),
    ],
    [
      item(3, { id: "other-3", special: true }),
      item(3, { isbn: "9780140328721" }),
    ],
  ]) {
    const result = collectionMissing(books, [catalog(items)]);
    assert.equal(result[0].missing, 1);
    assert.deepEqual(result[0].editions[0].ranges, [[2, 2]]);
    assert.deepEqual(result[0].editions[0].catalogVolumes, []);
  }
});

test("linked catalog names are compared with the owned title and large missing ranges stay bounded", () => {
  const result = collectionMissing(
    [book(1)],
    [catalog([item(2, { series: "Publisher alias" })])],
  );
  assert.equal(
    result[0].editions[0].catalogVolumes[0].item.catalogSeries,
    "A story",
  );
  const large = collectionMissing([book(1000000)], [catalog([item(500000)])]);
  assert.equal(large[0].missing, 999999);
  assert.deepEqual(large[0].editions[0].ranges, [
    [1, 499999],
    [500001, 999999],
  ]);
});

test("catalog requests deduplicate publisher aliases and skip unsupported publishers", () => {
  const specs = missingCatalogSpecs([
    book(1),
    book(2, { publisher: "Phoenix Next" }),
    book(3, { publisher: "Kodansha", type: "Manga (JP)" }),
    book(4, { publisher: "講談社", type: "Manga (JP)" }),
    book(5, { publisher: "Unsupported publisher" }),
  ]);
  assert.equal(specs.length, 2);
  assert.equal(specs[0].publisherId, "phoenix");
  assert.equal(specs[1].publisherId, "kodansha");
  assert.deepEqual(collectionMissing([], []), []);
});
