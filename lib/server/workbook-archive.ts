import { inflateRawSync } from "node:zlib";
import { AppError } from "./store.ts";

const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;

// XLSX is a ZIP archive. Check actual bounded inflation, not just attacker-
// supplied uncompressed sizes, before the spreadsheet parser sees its input.
// ZIP64, encryption and exotic compression are unnecessary for library files.
export function validateWorkbookArchive(buffer: Buffer) {
  const fail = () => {
    throw new AppError(
      "This workbook is invalid or too large. Use an XLSX smaller than 16 MB and 32 MB when expanded.",
    );
  };
  if (
    buffer.length < 22 ||
    buffer.length > MAX_ARCHIVE_BYTES ||
    buffer.readUInt32LE(0) !== 0x04034b50
  )
    fail();
  let end = buffer.length - 22;
  for (; end >= Math.max(0, buffer.length - 65557); end--)
    if (
      buffer.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + buffer.readUInt16LE(end + 20) === buffer.length
    )
      break;
  if (end < Math.max(0, buffer.length - 65557)) fail();
  // SheetJS scans for the last signature without validating the ZIP comment.
  // Both parsers must select the same end record.
  if (buffer.lastIndexOf(Buffer.from("504b0506", "hex")) !== end) fail();
  const entries = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  const directoryStart = buffer.readUInt32LE(end + 16);
  if (
    buffer.readUInt16LE(end + 4) ||
    buffer.readUInt16LE(end + 6) ||
    buffer.readUInt16LE(end + 8) !== entries ||
    !entries ||
    entries > 1024 ||
    directoryStart + directorySize !== end
  )
    fail();
  let cursor = directoryStart;
  let expanded = 0;
  const names = new Set<string>();
  const intervals: [number, number][] = [];
  function checkExtra(start: number, length: number) {
    const stop = start + length;
    if (stop > buffer.length) fail();
    while (start < stop) {
      if (start + 4 > stop) fail();
      const tag = buffer.readUInt16LE(start);
      const size = buffer.readUInt16LE(start + 2);
      // ZIP64 extras override sizes in SheetJS, even without ZIP64 sentinels.
      if (tag === 1 || start + 4 + size > stop) fail();
      start += 4 + size;
    }
  }
  try {
    for (let index = 0; index < entries; index++) {
      if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50)
        fail();
      const flags = buffer.readUInt16LE(cursor + 8);
      const method = buffer.readUInt16LE(cursor + 10);
      const compressedSize = buffer.readUInt32LE(cursor + 20);
      const expandedSize = buffer.readUInt32LE(cursor + 24);
      const nameLength = buffer.readUInt16LE(cursor + 28);
      const extraLength = buffer.readUInt16LE(cursor + 30);
      const commentLength = buffer.readUInt16LE(cursor + 32);
      const offset = buffer.readUInt32LE(cursor + 42);
      if (
        flags & 0x2041 ||
        ![0, 8].includes(method) ||
        buffer.readUInt16LE(cursor + 34) ||
        nameLength > 512 ||
        !nameLength ||
        cursor + 46 + nameLength + extraLength + commentLength > end ||
        offset + 30 > directoryStart
      )
        fail();
      expanded += expandedSize;
      if (expanded > MAX_EXPANDED_BYTES) fail();
      const name = buffer
        .subarray(cursor + 46, cursor + 46 + nameLength)
        .toString("utf8");
      // No files are extracted to disk, but reject normalized-path aliases so
      // the validator and spreadsheet archive lookup cannot disagree.
      if (
        names.has(name.toLowerCase()) ||
        /(?:^\/|\\|(?:^|\/)\.{1,2}(?:\/|$)|[\x00-\x1f\x7f])/.test(name)
      )
        fail();
      names.add(name.toLowerCase());
      checkExtra(cursor + 46 + nameLength, extraLength);
      if (
        buffer.readUInt32LE(offset) !== 0x04034b50 ||
        buffer.readUInt16LE(offset + 6) !== flags ||
        buffer.readUInt16LE(offset + 8) !== method ||
        buffer.readUInt16LE(offset + 26) !== nameLength
      )
        fail();
      const localCompressed = buffer.readUInt32LE(offset + 18);
      const localExpanded = buffer.readUInt32LE(offset + 22);
      if (
        (localCompressed !== compressedSize &&
          (!(flags & 8) || localCompressed !== 0)) ||
        (localExpanded !== expandedSize &&
          (!(flags & 8) || localExpanded !== 0))
      )
        fail();
      checkExtra(offset + 30 + nameLength, buffer.readUInt16LE(offset + 28));
      const dataStart =
        offset + 30 + nameLength + buffer.readUInt16LE(offset + 28);
      const dataEnd = dataStart + compressedSize;
      if (
        dataEnd > directoryStart ||
        !buffer
          .subarray(offset + 30, offset + 30 + nameLength)
          .equals(buffer.subarray(cursor + 46, cursor + 46 + nameLength))
      )
        fail();
      intervals.push([offset, dataEnd]);
      const data = buffer.subarray(dataStart, dataEnd);
      const actualSize =
        method === 0
          ? data.length
          : inflateRawSync(data, { maxOutputLength: Math.max(1, expandedSize) })
              .length;
      if (actualSize !== expandedSize) fail();
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    if (cursor !== end) fail();
    intervals.sort((a, b) => a[0] - b[0]);
    for (let index = 1; index < intervals.length; index++)
      if (intervals[index][0] < intervals[index - 1][1]) fail();
  } catch (error) {
    if (error instanceof AppError) throw error;
    fail();
  }
}
