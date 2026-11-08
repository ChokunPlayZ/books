# Importing and restoring a collection

1. In your collection sheet, choose **File → Download → Microsoft Excel (.xlsx)**. Download the whole workbook to include the hidden helper tabs.
2. Open the new app and choose **Data & backups**.
3. Select the `.xlsx` file and click **Review import**. Check the counts, sample records and any warnings.
4. Click **Import this collection**. Imports are transactional and a retry of the same file does not add it twice.

After importing, a durable background task discovers metadata for owned books, including records with only a series name and volume number. The import does not wait for remote stores. Work resumes after server restarts, respects queue pause and source cooldowns, and runs in low-priority batches of 25 books. CLI imports queue the same work; it runs when the app server starts.

Discovery reuses a matched publisher series category for sibling volumes, falling back to a targeted store lookup only for missing volumes. It fills blank ISBNs only from verified product details, and can fill missing publisher, format, cover, product link, page count and MSRP. Existing values, personal prices, purchases, reading state, notes and duplicate copies are preserved. Ambiguous formats, bundles and special editions are not automatically matched. Books edited or removed while a lookup is running are left untouched. An unavailable source never rolls back the imported collection.

A workbook imports `Sheet1`, `_BookAppTrash`, `_BookAppReleases`, and `_BookAppSeriesCatalogs` when present. This carries over owned books, Recently removed, saved releases, and selected publisher category links. It copies cell values; spending summaries are calculated in the app. Choices are rebuilt from your records plus the existing standard type/status choices. Unused spreadsheet dropdown choices are not included in Excel exports read by this importer.

Your existing columns remain the import contract:

| ISBN | Series | Type | Publisher | Status | Volume | Source | Price | Date | Note |
| ---- | ------ | ---- | --------- | ------ | ------ | ------ | ----- | ---- | ---- |

The importer preserves intentional duplicate copies, fractional volumes, zero prices for gifts and blank prices for unknown amounts. It expands safely representable scientific-notation ISBNs and reports a warning for review. Invalid legacy ISBNs are kept and flagged; barcode ownership checks cannot match those until corrected. Notes beginning with `=` remain literal text.

CSV and JSON arrays also import owned books. CSV dates must be `YYYY-MM-DD`; use `.xlsx` to carry over spreadsheet date cells without ambiguity. Library and series JSON exports restore ISBNs, titles and personal book fields only; `title` maps to the library's series/title field. They preserve duplicates, blank amounts, gifts and fractional volumes, but do not contain publisher metadata, covers, saved releases or removed books. A complete server JSON backup (`npm run backup`) or an older app backup also restores removed books, saved releases, catalog links and unused dropdown choices.

CSV is parsed as text, not auto-detected as a binary spreadsheet: renaming XLSX/ZIP files to `.csv` is rejected. Quoted/multiline fields, comma/semicolon/tab separators, UTF-8 and BOM-marked UTF-16 are supported; CSV fields are limited to 8,192 characters.

CSV/XLSX files are limited to 16 MiB; XLSX archives must expand to at most 32 MiB. Import sheets may contain up to 20,000 records and 32 columns, with at most ten sheets. JSON backups may contain up to 128 MiB to accommodate stored covers. Web imports and backup downloads share one process-local transfer slot; uploads have a 120-second body deadline, and each account may make ten upload requests per 15 minutes (preview and import each count).

Imports require an empty library to avoid confusing intentional second copies with records already imported. For a fresh library, create a separate PostgreSQL database and point `DATABASE_URL` at it:

```sh
DATABASE_URL=postgresql://books:books-local@localhost:5432/books_import npm run import -- collection.xlsx --preview
DATABASE_URL=postgresql://books:books-local@localhost:5432/books_import npm run import -- collection.xlsx
DATABASE_URL=postgresql://books:books-local@localhost:5432/books_import npm run dev
```

Importing never writes to or changes the Google Sheet. Once the latest workbook is imported, use the new app for ongoing collection changes. The sheet and standalone database do not automatically synchronize.
