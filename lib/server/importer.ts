import * as XLSX from "xlsx";
import {
  BOOK_APP,
  canonicalIsbn,
  cleanRelease,
  digest,
  dateSerial,
  seriesCatalogRequest,
  safeSeriesCatalogUrl,
  bookMetadata,
  safeCoverUrl,
} from "../domain.ts";
import { imageType, MAX_IMAGE_BYTES, coverDigest } from "./covers.ts";
import { AppError } from "./store.ts";
import type { Book, ImportReview } from "../types.ts";
import { normalizeBookType } from "../domain/book-type.ts";
import { validateWorkbookArchive } from "./workbook-archive.ts";

const MAX_RECORDS = 20000;

// Do not send CSV uploads through SheetJS's binary-format auto-detection. A ZIP
// renamed to .csv otherwise bypasses the XLSX expansion checks entirely. Bound
// rows and columns while parsing, rather than after allocating a huge sheet.
function csvWorkbook(buffer: Buffer) {
  let text: string;
  if (buffer[0] === 0xff && buffer[1] === 0xfe)
    text = new TextDecoder("utf-16le", { fatal: true }).decode(buffer);
  else if (buffer[0] === 0xfe && buffer[1] === 0xff)
    text = new TextDecoder("utf-16be", { fatal: true }).decode(buffer);
  else text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
    throw new AppError(
      "Choose a text CSV file, not a renamed binary workbook.",
    );
  // Header inference must not split an unvalidated 16 MB line into millions
  // of empty strings before the column limit has a chance to run.
  const firstLine = text.slice(0, 8192).split(/[\r\n]/, 1)[0];
  const counts = new Map([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  for (const char of firstLine)
    if (counts.has(char)) counts.set(char, counts.get(char) + 1);
  const separator = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  function field() {
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > 32)
      throw new AppError(
        "Each import sheet must contain at most 20,000 records and 32 columns.",
      );
  }
  function record() {
    field();
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
    if (rows.length > MAX_RECORDS + 1)
      throw new AppError("The import must contain at most 20,000 books.");
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === separator) field();
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      record();
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (closed) {
      if (char !== " ")
        throw new AppError("The CSV contains an invalid quoted field.");
    } else cell += char;
    if (cell.length > 8192)
      throw new AppError("The CSV contains an overlong field.");
  }
  if (quoted) throw new AppError("The CSV contains an unclosed quoted field.");
  record();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Sheet1",
  );
  return workbook;
}

function objectBook(input, warnings, location) {
  if (!input || typeof input !== "object")
    throw new AppError(`${location}: invalid book record.`);
  const data = {} as Book;
  for (const field of BOOK_APP.fields) {
    let value = input[field] ?? (field === "series" ? input.title : "") ?? "";
    if (
      field === "isbn" &&
      typeof value === "string" &&
      /^\d+(?:\.\d+)?e\+?\d+$/i.test(value)
    ) {
      if (!Number.isSafeInteger(Number(value)))
        throw new AppError(`${location}: ISBN cannot be read safely.`);
      value = String(Number(value));
      warnings.push(
        `${location}: expanded an ISBN from scientific notation; check it against the book.`,
      );
    }
    if (["volume", "price"].includes(field)) {
      if (value === "") data[field] = "";
      else if (
        !/^\d+(?:\.\d+)?$/.test(String(value)) ||
        !Number.isFinite(Number(value))
      )
        throw new AppError(
          `${location}: ${field} must be a non-negative number or blank.`,
        );
      else data[field] = Number(value);
    } else if (field === "date") {
      if (typeof value === "number" && Number.isFinite(value))
        value = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)
          .toISOString()
          .slice(0, 10);
      if (value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))
          throw new AppError(
            `${location}: use YYYY-MM-DD dates, or download the sheet as Excel (.xlsx) to preserve its dates.`,
          );
        dateSerial(String(value));
      }
      data[field] = String(value);
    } else {
      data[field] = String(value).trim();
      if (data[field].length > (field === "note" ? 2000 : 500))
        throw new AppError(`${location}: ${field} is too long.`);
    }
  }
  if (!data.series)
    throw new AppError(`${location}: a series or title is required.`);
  const legacyType = data.type;
  data.type = normalizeBookType(data.type);
  if (data.isbn && !canonicalIsbn(data.isbn))
    warnings.push(
      `${location}: kept an existing ISBN with an invalid checksum. Correct it with Add ISBN before relying on barcode ownership checks.`,
    );
  if (!data.type || !data.status)
    warnings.push(
      `${location}: kept a blank ${!data.type ? "book type" : "reading status"}.`,
    );
  if (input.coverId) {
    if (!/^[a-f0-9]{64}$/.test(input.coverId))
      throw new AppError(`${location}: invalid cover ID.`);
    data.coverId = input.coverId;
  }
  return Object.assign(
    data,
    bookMetadata({
      ...data,
      coverUrl: input.coverUrl,
      publisherUrl: input.publisherUrl,
      pageCount: input.pageCount,
      msrp: input.msrp,
      msrpCurrency: input.msrpCurrency,
      edition: input.edition ?? legacyType,
    }),
  );
}

function fromWorkbook(buffer, filename) {
  if (buffer.length > 16 * 1024 * 1024)
    throw new AppError("Choose an XLSX or CSV file smaller than 16 MB.");
  const csv = /\.csv$/i.test(filename);
  if (!csv) validateWorkbookArchive(buffer);
  const workbook = csv
    ? csvWorkbook(buffer)
    : XLSX.read(buffer, {
        type: "buffer",
        raw: true,
        cellDates: false,
        sheetRows: MAX_RECORDS + 2,
      });
  if (workbook.SheetNames.length > 10)
    throw new AppError("The workbook has too many sheets.");
  for (const sheet of Object.values(workbook.Sheets)) {
    const range = XLSX.utils.decode_range(
      sheet["!fullref"] || sheet["!ref"] || "A1",
    );
    if (range.e.r > MAX_RECORDS || range.e.c > 31)
      throw new AppError(
        "Each import sheet must contain at most 20,000 records and 32 columns.",
      );
  }
  const sheet =
    workbook.Sheets.Sheet1 ||
    (workbook.SheetNames.length === 1
      ? workbook.Sheets[workbook.SheetNames[0]]
      : null);
  if (!sheet)
    throw new AppError("The workbook must include your Sheet1 collection tab.");
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (
    !rows.length ||
    !BOOK_APP.headers.every(
      (header, index) => String(rows[0][index]).trim() === header,
    )
  )
    throw new AppError(
      "Expected the ten columns ISBN, Series, Type, Publisher, Status, Volume, Source, Price, Date, Note.",
    );
  const books = rows
    .slice(1)
    .filter((row) => row.slice(0, 10).some((value) => value !== ""))
    .map((row) =>
      Object.fromEntries(
        BOOK_APP.fields.map((key, index) => [key, row[index] ?? ""]),
      ),
    );
  function helper(name, headers) {
    if (!workbook.Sheets[name]) return [];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      defval: "",
      blankrows: false,
    });
    if (!headers.every((header, index) => data[0]?.[index] === header))
      throw new AppError(`${name}: unexpected helper-tab columns.`);
    return data.slice(1);
  }
  const trash = helper("_BookAppTrash", [
    "Trash ID",
    "Removed At",
    "State",
    "Original Row",
    "Book JSON",
  ])
    .filter((row) => row[2] === "removed")
    .map((row) => ({
      id: row[0],
      removedAt: row[1],
      book: JSON.parse(row[4]),
    }));
  const savedReleases = helper("_BookAppReleases", [
    "Release ID",
    "State",
    "Book JSON",
    "Updated At",
  ])
    .filter((row) => row[1] === "saved")
    .map((row) => JSON.parse(row[2]));
  const seriesCatalogs = helper("_BookAppSeriesCatalogs", [
    "Series",
    "Publisher ID",
    "Type",
    "Catalog URL",
    "Catalog Title",
  ]).map((row) => ({
    series: row[0],
    publisherId: row[1],
    type: row[2],
    url: row[3],
    title: row[4],
  }));
  const options = {};
  if (/\.csv$/i.test(filename))
    return {
      books,
      trash,
      savedReleases,
      seriesCatalogs,
      options,
      warnings: [
        "CSV contains only owned books. Use a full Excel workbook to include Recently removed, saved releases and linked catalogs.",
      ],
    };
  return { books, trash, savedReleases, seriesCatalogs, options, warnings: [] };
}

export function parseImport(buffer, filename) {
  if (!buffer.length || buffer.length > 128 * 1024 * 1024)
    throw new AppError("Choose a non-empty import file smaller than 128 MB.");
  let raw;
  try {
    if (/\.json$/i.test(filename)) {
      raw = JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
      if (Array.isArray(raw)) raw = { books: raw };
      else if (raw.format !== "book-collection" || raw.version !== 1)
        throw new AppError("This is not a supported meemai backup.");
    } else if (/\.(csv|xlsx)$/i.test(filename))
      raw = fromWorkbook(buffer, filename);
    else
      throw new AppError(
        "Choose a Google Sheets Excel export, collection CSV, or meemai JSON backup.",
      );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "This import file could not be read. Check its format and download it again.",
    );
  }
  if (!Array.isArray(raw.books) || raw.books.length > MAX_RECORDS)
    throw new AppError("The import must contain at most 20,000 books.");
  for (const key of ["trash", "savedReleases", "seriesCatalogs", "covers"])
    if (
      raw[key] != null &&
      (!Array.isArray(raw[key]) || raw[key].length > MAX_RECORDS)
    )
      throw new AppError(`Invalid ${key} in the backup.`);
  if (
    raw.warnings != null &&
    (!Array.isArray(raw.warnings) ||
      raw.warnings.length > MAX_RECORDS ||
      raw.warnings.some(
        (value) => typeof value !== "string" || value.length > 2000,
      ))
  )
    throw new AppError("Invalid warnings in the backup.");
  const warnings = [...(raw.warnings || [])];
  const books = raw.books.map((input, index) =>
    objectBook(input, warnings, `Book ${index + 1}`),
  );
  const trash = (raw.trash || []).map((entry, index) => {
    const removedAt = String(entry.removedAt || new Date().toISOString());
    if (!Number.isFinite(Date.parse(removedAt)))
      throw new AppError("Invalid removal date in the backup.");
    return {
      id: String(entry.id || ""),
      removedAt,
      book: objectBook(entry.book, warnings, `Removed book ${index + 1}`),
    };
  });
  const savedReleases = (raw.savedReleases || []).map(cleanRelease);
  const seriesCatalogs = (raw.seriesCatalogs || []).map((item) => {
    const spec = seriesCatalogRequest(item),
      url = safeSeriesCatalogUrl(item.url, spec.publisherId);
    if (!url)
      throw new AppError("Invalid publisher category URL in the import.");
    return {
      ...spec,
      url,
      title: String(item.title || spec.series).slice(0, 500),
      ...(item.edition || item.type !== spec.type
        ? { edition: String(item.edition || item.type).slice(0, 500) }
        : {}),
    };
  });
  const options = {};
  if (
    raw.options != null &&
    (typeof raw.options !== "object" || Array.isArray(raw.options))
  )
    throw new AppError("Invalid dropdown choices in the backup.");
  // Avoid Object.entries on unvalidated strings (one allocated pair per byte).
  for (const field in raw.options || {}) {
    const values = raw.options[field];
    if (
      !["series", "type", "publisher", "status", "source"].includes(field) ||
      !Array.isArray(values) ||
      values.length > MAX_RECORDS ||
      values.some((value) => typeof value !== "string" || value.length > 500)
    )
      throw new AppError("Invalid dropdown choices in the backup.");
    options[field] = values;
  }
  const covers = (raw.covers || []).map((image) => {
    if (
      typeof image.data !== "string" ||
      image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
    )
      throw new AppError("Invalid stored cover in the backup.");
    const body = Buffer.from(image.data, "base64");
    const contentType = imageType(body);
    if (
      !contentType ||
      body.toString("base64") !== image.data ||
      body.length > MAX_IMAGE_BYTES ||
      contentType !== image.contentType ||
      coverDigest(body) !== image.id
    )
      throw new AppError("Invalid stored cover in the backup.");
    if (
      image.sources != null &&
      (!Array.isArray(image.sources) ||
        image.sources.length > MAX_RECORDS ||
        image.sources.some((url) => !safeCoverUrl(url)))
    )
      throw new AppError("Invalid cover source in the backup.");
    return {
      id: image.id,
      body,
      contentType,
      sources: (image.sources || []).map((url) => safeCoverUrl(url)),
    };
  });
  const coverIds = new Set(covers.map((image) => image.id));
  if (
    [...books, ...trash.map((entry) => entry.book), ...savedReleases].some(
      (book) => book.coverId && !coverIds.has(book.coverId),
    )
  )
    throw new AppError(
      "A book refers to a missing stored cover in the backup.",
    );
  const fingerprint = digest(buffer);
  return {
    fingerprint,
    covers,
    books,
    trash,
    savedReleases,
    seriesCatalogs,
    options,
    warnings,
  };
}

export function importSummary(plan): ImportReview {
  return {
    fingerprint: plan.fingerprint,
    books: plan.books.length,
    trash: plan.trash.length,
    savedReleases: plan.savedReleases.length,
    seriesCatalogs: plan.seriesCatalogs.length,
    warnings: plan.warnings,
    sample: plan.books.slice(0, 5),
  };
}
