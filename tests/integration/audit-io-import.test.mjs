import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import { BOOK_APP } from "../../lib/domain.ts";
import { parseImport } from "../../lib/server/importer.ts";
import { readImportForm } from "../../lib/server/import-upload.ts";
import { validateWorkbookArchive } from "../../lib/server/workbook-archive.ts";
import { readBody } from "../../lib/server/http.ts";

function archive(entries, prefix = Buffer.alloc(0)) {
  const files = [prefix],
    directory = [];
  let offset = prefix.length;
  for (const {
    name: rawName,
    body = Buffer.from("safe"),
    size = body.length,
  } of entries) {
    const name = Buffer.from(rawName),
      data = deflateRawSync(body);
    const local = Buffer.alloc(30),
      central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    files.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const bytes = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(bytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, bytes, end]);
}

function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      BOOK_APP.headers,
      ["", "Audit workbook", "Manga", "", "Read", 1],
    ]),
    "Sheet1",
  );
  return XLSX.write(book, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  });
}

test("audit IO: binary workbooks cannot bypass archive validation by using the CSV extension", () => {
  const bytes = workbook();
  assert.equal(
    parseImport(bytes, "books.xlsx").books[0].series,
    "Audit workbook",
  );
  assert.throws(() => parseImport(bytes, "books.csv"), { status: 400 });
  assert.throws(
    () =>
      parseImport(
        archive([
          { name: "xl/workbook.xml", body: Buffer.alloc(1024 * 1024), size: 1 },
        ]),
        "bomb.csv",
      ),
    { status: 400 },
  );
});

test("audit IO: ordinary CSV quoting, Unicode, BOMs, separators and multiline notes survive", () => {
  for (const separator of [",", ";", "\t"]) {
    const header = BOOK_APP.headers
      .map((value) => `"${value}"`)
      .join(separator);
    const row = [
      "",
      '"หนังสือ, with ""quotes"""',
      "Manga",
      "",
      "Read",
      "1",
      "",
      "12.5",
      "2026-11-06",
      '"line one\nline two"',
    ].join(separator);
    const text = `${header}\r\n${row}\r\n`;
    for (const bytes of [
      Buffer.from(text),
      Buffer.from("\uFEFF" + text),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
    ]) {
      const result = parseImport(bytes, "books.csv").books[0];
      assert.equal(result.series, 'หนังสือ, with "quotes"');
      assert.equal(result.note, "line one\nline two");
      assert.equal(result.price, 12.5);
    }
  }
});

test("audit IO: CSV dimensions, giant fields and malformed quotations fail before sheet construction", () => {
  const header = BOOK_APP.headers.join(",");
  for (const [text, expected] of [
    [Array(33).fill("x").join(","), /32 columns/],
    [",".repeat(1024 * 1024), /32 columns/],
    [`${header}\n,${"x".repeat(8193)}`, /overlong/],
    [`${header}\n,"unterminated`, /unclosed/],
    [`${header}\n,"closed"trailing`, /invalid quoted/],
    [`${header}\n${",Title,Manga,,Read,1,,,,\n".repeat(20001)}`, /20,000/],
  ])
    assert.throws(() => parseImport(Buffer.from(text), "books.csv"), expected);
});

test("audit IO: archive prefixes, path aliases, traversal names and case-folded collisions are rejected", () => {
  validateWorkbookArchive(archive([{ name: "xl/workbook.xml" }]));
  assert.throws(
    () =>
      validateWorkbookArchive(
        archive([{ name: "xl/workbook.xml" }], Buffer.from("not ZIP")),
      ),
    { status: 400 },
  );
  for (const name of [
    "../outside",
    "xl/../../outside",
    "/absolute",
    "xl\\workbook.xml",
    "xl/./workbook.xml",
    "xl/\u0000workbook.xml",
  ])
    assert.throws(() => validateWorkbookArchive(archive([{ name }])), {
      status: 400,
    });
  assert.throws(
    () =>
      validateWorkbookArchive(
        archive([{ name: "xl/workbook.xml" }, { name: "XL/WORKBOOK.XML" }]),
      ),
    { status: 400 },
  );
});

test("audit IO: expansion limits apply to actual bytes and the total declared output", () => {
  for (const entries of [
    [{ name: "xl/workbook.xml", body: Buffer.alloc(1024 * 1024), size: 1 }],
    [{ name: "xl/workbook.xml", size: 33 * 1024 * 1024 }],
  ])
    assert.throws(() => validateWorkbookArchive(archive(entries)), {
      status: 400,
    });
});

test("audit IO: dropdown options must be an object before enumeration", () => {
  for (const options of ["x".repeat(2 * 1024 * 1024), [], 42, true])
    assert.throws(
      () =>
        parseImport(
          Buffer.from(
            JSON.stringify({
              format: "book-collection",
              version: 1,
              books: [],
              options,
            }),
          ),
          "backup.json",
        ),
      /Invalid dropdown choices/,
    );
  assert.deepEqual(
    parseImport(
      Buffer.from(
        JSON.stringify({
          format: "book-collection",
          version: 1,
          books: [],
          options: { series: ["Safe"] },
        }),
      ),
      "backup.json",
    ).options,
    { series: ["Safe"] },
  );
});

const upload = (form) =>
  new Request("https://books.example/api/import", {
    method: "POST",
    body: form,
  });

test("audit IO: multipart part-count limits run before native FormData allocation", async (t) => {
  let parsed = false;
  t.mock.method(Response.prototype, "formData", async () => {
    parsed = true;
    return new FormData();
  });
  const form = new FormData();
  for (let i = 0; i < 100; i++) form.append("field" + i, "");
  await assert.rejects(readImportForm(upload(form)), /too many fields/);
  assert.equal(parsed, false);
});

test("audit IO: uploads accept the browser's file/action/fingerprint fields but reject duplicates and malformed media types", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob(["[]"], { type: "application/json" }),
    "backup.json",
  );
  form.append("action", "import");
  form.append("fingerprint", "a".repeat(64));
  const result = await readImportForm(upload(form));
  assert.equal(result.get("file").name, "backup.json");
  assert.equal(result.get("fingerprint"), "a".repeat(64));
  form.append("action", "preview");
  await assert.rejects(readImportForm(upload(form)), /invalid fields/);
  for (const contentType of [
    "application/json",
    "multipart/form-data",
    'multipart/form-data; boundary="a"; boundary="b"',
  ])
    await assert.rejects(
      readImportForm(
        new Request("https://books.example/api/import", {
          method: "POST",
          headers: { "Content-Type": contentType },
          body: "{}",
        }),
      ),
      { status: 415 },
    );
  await assert.rejects(
    readImportForm(
      new Request("https://books.example/api/import", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=abc" },
        body: "invalid envelope",
      }),
    ),
    { status: 400 },
  );
});

test("audit IO: bounded body reads cancel stalled streams and release the reader", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(readBody({ headers: new Headers(), body }, 10, 10), {
    status: 408,
  });
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("audit IO: declared oversize bodies are cancelled and tiny chunks are coalesced without byte loss", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readBody({ headers: new Headers({ "Content-Length": "11" }), body }, 10),
    { status: 413 },
  );
  assert.equal(cancelled, true);
  let cursor = 0;
  const tiny = new ReadableStream({
    pull(controller) {
      if (cursor === 10000) controller.close();
      else controller.enqueue(Uint8Array.of(cursor++ % 256));
    },
  });
  const result = await readBody({ headers: new Headers(), body: tiny }, 10000);
  assert.equal(result.length, 10000);
  assert.deepEqual(
    result,
    Buffer.from(Array.from({ length: 10000 }, (_, index) => index % 256)),
  );
  assert.equal(tiny.locked, false);
});
