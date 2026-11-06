import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import { validateWorkbookArchive } from "../../lib/server/workbook-archive.ts";
import { parseImport } from "../../lib/server/importer.ts";

function archive(
  body,
  declaredSize = body.length,
  {
    flags = 0,
    localSize = declaredSize,
    extra = Buffer.alloc(0),
    comment = Buffer.alloc(0),
  } = {},
) {
  const data = deflateRawSync(body);
  const name = Buffer.from("xl/workbook.xml");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(localSize, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(extra.length, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(extra.length, 30);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length + extra.length, 12);
  end.writeUInt32LE(
    local.length + name.length + extra.length + data.length,
    16,
  );
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([
    local,
    name,
    extra,
    data,
    central,
    name,
    extra,
    end,
    comment,
  ]);
}

test("workbook archives enforce declared and actual expansion limits before parsing", () => {
  validateWorkbookArchive(archive(Buffer.from("small XML")));
  assert.throws(
    () => validateWorkbookArchive(archive(Buffer.alloc(1024 * 1024), 1)),
    { status: 400 },
  );
  assert.throws(
    () =>
      validateWorkbookArchive(archive(Buffer.from("small"), 33 * 1024 * 1024)),
    { status: 400 },
  );
  for (const input of [
    Buffer.alloc(0),
    Buffer.from("not a ZIP"),
    archive(Buffer.from("small")).subarray(0, -1),
  ])
    assert.throws(() => validateWorkbookArchive(input), { status: 400 });
});

test("ZIP64 overrides, descriptor size tricks and competing end signatures cannot bypass bounds", () => {
  const body = Buffer.from("small XML");
  const zip64 = Buffer.alloc(12);
  zip64.writeUInt16LE(1, 0);
  zip64.writeUInt16LE(8, 2);
  zip64.writeBigUInt64LE(2n ** 32n, 4);
  for (const input of [
    archive(body, body.length, { extra: zip64 }),
    archive(body, body.length, { flags: 8, localSize: 2 ** 30 }),
    archive(body, body.length, { comment: Buffer.from("504b0506", "hex") }),
  ])
    assert.throws(() => validateWorkbookArchive(input), { status: 400 });
});

test("ordinary compressed XLSX files still import, while extreme sheet dimensions do not", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [
        "ISBN",
        "Series",
        "Type",
        "Publisher",
        "Status",
        "Volume",
        "Source",
        "Price",
        "Date",
        "Note",
      ],
      ["", "Safe library", "Manga", "", "Read", 1, "", "", "", ""],
    ]),
    "Sheet1",
  );
  const bytes = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  });
  assert.equal(
    parseImport(bytes, "books.xlsx").books[0].series,
    "Safe library",
  );
  const tooWide = Array.from(
    { length: 33 },
    (_, index) => "column" + index,
  ).join(",");
  assert.throws(
    () => parseImport(Buffer.from(tooWide), "books.csv"),
    /32 columns/,
  );
});

test("backup warning fields cannot expand a large string into an unbounded array", () => {
  for (const warnings of [
    "not-an-array",
    ["x".repeat(2001)],
    Array(20001).fill(""),
  ]) {
    const bytes = Buffer.from(
      JSON.stringify({
        format: "book-collection",
        version: 1,
        books: [],
        warnings,
      }),
    );
    assert.throws(() => parseImport(bytes, "books.json"), /Invalid warnings/);
  }
});
