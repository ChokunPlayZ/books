import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOK_SOURCE_ISBN_PREFIXES,
  bookSourceApplies,
  isbnSearchLinks,
} from "../../lib/domain/book-sources.ts";
import { SCRAPER_SOURCES } from "../../lib/server/scrapers/registry.ts";

test("publisher choices use the automatic lookup prefix rules", () => {
  for (const source of SCRAPER_SOURCES)
    if (source.isbnPrefixes)
      assert.deepEqual(
        BOOK_SOURCE_ISBN_PREFIXES[source.id],
        source.isbnPrefixes,
      );
});

test("Yen Press is omitted for Japanese and Thai editions, including without ISBNs", () => {
  for (const type of [
    "Manga (JP)",
    "Manga (JP) (Color)",
    "LN (TH)",
    "Manga (TH)",
  ])
    assert.equal(bookSourceApplies("yenpress", { type }), false);
  assert.equal(bookSourceApplies("yenpress", { type: "LN (EN)" }), true);
  assert.equal(bookSourceApplies("yenpress", { type: "Other" }), true);
  assert.equal(bookSourceApplies("yenpress", { isbn: "4063951375" }), false);
  assert.equal(bookSourceApplies("yenpress", { isbn: "9786166247275" }), false);
  assert.equal(bookSourceApplies("yenpress", { isbn: "0140328726" }), true);
  assert.equal(bookSourceApplies("yenpress", { isbn: "9798400903526" }), true);
  assert.equal(
    bookSourceApplies("yenpress", { isbn: "0140328726", type: "Manga (TH)" }),
    false,
  );
});

test("every language-specific publisher stays hidden for other title languages, even with a conflicting ISBN", () => {
  const thai = [
    "naiin",
    "yaakz",
    "firstpage",
    "animag",
    "dexpress",
    "phoenix",
    "luckpim",
  ];
  const japanese = ["kodansha", "hanmoto"];
  for (const source of thai)
    for (const type of [
      "Manga (EN)",
      "LN (EN)",
      "Manga (JP)",
      "Manga (JP) (Color)",
    ])
      for (const isbn of ["", "9786166247275", "0140328726", "4063951375"])
        assert.equal(
          bookSourceApplies(source, { type, isbn }),
          false,
          `${source}: ${type}, ${isbn}`,
        );
  for (const source of japanese)
    for (const type of [
      "Manga (TH)",
      "LN (TH)",
      "Manga (TH) (Color)",
      "Manga (EN)",
      "LN (EN)",
    ])
      for (const isbn of ["", "9786166247275", "0140328726", "4063951375"])
        assert.equal(
          bookSourceApplies(source, { type, isbn }),
          false,
          `${source}: ${type}, ${isbn}`,
        );
  for (const source of thai)
    assert.equal(
      bookSourceApplies(source, { type: "Manga (TH)", isbn: "9786166247275" }),
      true,
    );
  for (const source of japanese)
    assert.equal(
      bookSourceApplies(source, { type: "Manga (JP)", isbn: "4063951375" }),
      true,
    );
  assert.equal(
    bookSourceApplies("lilyhouse", { type: "LN (EN)", isbn: "0140328726" }),
    true,
  );
});

test("Thai and Japanese publishers require the matching edition while multilingual sources remain available", () => {
  assert.equal(bookSourceApplies("phoenix", { type: "Manga (JP)" }), false);
  assert.equal(bookSourceApplies("phoenix", { type: "LN (TH)" }), true);
  assert.equal(bookSourceApplies("kodansha", { type: "Manga (JP)" }), true);
  assert.equal(bookSourceApplies("kodansha", { type: "Manga (EN)" }), false);
  for (const type of ["Manga (JP)", "Manga (TH)", "LN (EN)"])
    for (const source of [
      "kinokuniya",
      "google-books",
      "open-library",
      "unknown",
      "constructor",
      "toString",
    ])
      assert.equal(bookSourceApplies(source, { type }), true);
});

test("ISBN search links omit unrelated Thai shops and canonicalize ISBN-10", () => {
  assert.deepEqual(
    isbnSearchLinks("9786166247275").map((source) => source.id),
    ["naiin", "phoenix", "firstpage", "animag", "dexpress", "kinokuniya"],
  );
  for (const isbn of ["4063951375", "0140328726", "9798400903526"])
    assert.deepEqual(
      isbnSearchLinks(isbn).map((source) => source.id),
      ["kinokuniya"],
    );
  assert.match(isbnSearchLinks("0140328726")[0].url, /9780140328721$/);
  assert.deepEqual(isbnSearchLinks("invalid"), []);
  for (const type of ["Manga (EN)", "Manga (JP)"])
    assert.deepEqual(
      isbnSearchLinks("9786166247275", type).map((source) => source.id),
      ["kinokuniya"],
    );
});
