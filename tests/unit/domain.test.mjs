import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIsbn,
  canonicalIsbn,
  normalizeBook,
} from "../../lib/domain.ts";

test("ISBN normalization accepts prefixes and ISBN-10 equivalents and rejects bad barcodes", () => {
  assert.equal(normalizeIsbn("ISBN-13: 978-0-140-32872-1"), "9780140328721");
  assert.equal(normalizeIsbn("0-8044-2957-X"), "080442957X");
  assert.equal(canonicalIsbn("0140328726"), "9780140328721");
  assert.equal(normalizeIsbn(""), "");
  for (const value of [
    "9780140328722",
    "1920079006008",
    "978abc0140328721",
    "1234567890",
    "978014032872100",
  ])
    assert.throws(() => normalizeIsbn(value), /not valid/);
});

test("book validation preserves gifts, unknown prices and decimal volumes while rejecting invalid amounts and dates", () => {
  const input = {
    isbn: "",
    series: "A story",
    type: "Manga (TH)",
    publisher: "",
    status: "Sealed",
    volume: "14.5",
    source: "",
    price: "0",
    date: "2026-10-09",
    note: "",
  };
  const values = normalizeBook(input);
  assert.equal(values[5], 14.5);
  assert.equal(values[7], 0);
  assert.equal(values[8], 46304);
  assert.equal(normalizeBook({ ...input, price: "" })[7], "");
  for (const date of ["2026-02-30", "2026-13-01", "26-10-09"])
    assert.throws(() => normalizeBook({ ...input, date }), /valid date/);
  for (const price of ["-1", "Infinity", "1e4", "oops"])
    assert.throws(() => normalizeBook({ ...input, price }), /non-negative/);
  assert.throws(() => normalizeBook({ ...input, series: "" }), /series/);
});
