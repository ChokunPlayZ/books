import * as XLSX from "xlsx";
import {
  BOOK_APP,
  canonicalIsbn_,
  cleanRelease_,
  digest_,
  dateSerial_,
  seriesCatalogRequest_,
  safeSeriesCatalogUrl_,
} from "../domain.mjs";
import { AppError } from "./store.mjs";

const MAX_RECORDS = 20000;
function objectBook(input, warnings, location) {
  if (!input || typeof input !== "object")
    throw new AppError(`${location}: invalid book record.`);
  const data = {};
  for (const field of BOOK_APP.fields) {
    let value = input[field] ?? "";
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
        dateSerial_(String(value));
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
  if (data.isbn && !canonicalIsbn_(data.isbn))
    warnings.push(
      `${location}: kept an existing ISBN with an invalid checksum. Correct it with Add ISBN before relying on barcode ownership checks.`,
    );
  if (!data.type || !data.status)
    warnings.push(
      `${location}: kept a blank ${!data.type ? "book type" : "reading status"}.`,
    );
  return data;
}

function fromWorkbook(buffer, filename) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    raw: true,
    cellDates: false,
  });
  const sheet =
    workbook.Sheets.Sheet1 ||
    (workbook.SheetNames.length === 1
      ? workbook.Sheets[workbook.SheetNames[0]]
      : null);
  if (!sheet)
    throw new AppError("The workbook must include your Sheet1 collection tab.");
  const rows = XLSX.utils.sheet_to_json(sheet, {
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
  if (!buffer.length || buffer.length > 10 * 1024 * 1024)
    throw new AppError("Choose a non-empty import file smaller than 10 MB.");
  let raw;
  try {
    if (/\.json$/i.test(filename)) {
      raw = JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
      if (Array.isArray(raw)) raw = { books: raw };
      else if (raw.format !== "book-collection" || raw.version !== 1)
        throw new AppError("This is not a supported Book Collection backup.");
    } else if (/\.(csv|xlsx)$/i.test(filename))
      raw = fromWorkbook(buffer, filename);
    else
      throw new AppError(
        "Choose a Google Sheets Excel export, collection CSV, or Book Collection JSON backup.",
      );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "This import file could not be read. Check its format and download it again.",
    );
  }
  if (!Array.isArray(raw.books) || raw.books.length > MAX_RECORDS)
    throw new AppError("The import must contain at most 20,000 books.");
  for (const key of ["trash", "savedReleases", "seriesCatalogs"])
    if (
      raw[key] != null &&
      (!Array.isArray(raw[key]) || raw[key].length > MAX_RECORDS)
    )
      throw new AppError(`Invalid ${key} in the backup.`);
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
  const savedReleases = (raw.savedReleases || []).map(cleanRelease_);
  const seriesCatalogs = (raw.seriesCatalogs || []).map((item) => {
    const spec = seriesCatalogRequest_(item),
      url = safeSeriesCatalogUrl_(item.url, spec.publisherId);
    if (!url)
      throw new AppError("Invalid publisher category URL in the import.");
    return {
      ...spec,
      url,
      title: String(item.title || spec.series).slice(0, 500),
    };
  });
  const options = {};
  for (const [field, values] of Object.entries(raw.options || {})) {
    if (
      !["series", "type", "publisher", "status", "source"].includes(field) ||
      !Array.isArray(values) ||
      values.length > MAX_RECORDS ||
      values.some((value) => typeof value !== "string" || value.length > 500)
    )
      throw new AppError("Invalid dropdown choices in the backup.");
    options[field] = values;
  }
  const fingerprint = digest_(buffer);
  return {
    fingerprint,
    books,
    trash,
    savedReleases,
    seriesCatalogs,
    options,
    warnings,
  };
}

export function importSummary(plan) {
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
