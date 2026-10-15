# Importing and restoring a collection

1. In your collection sheet, choose **File → Download → Microsoft Excel (.xlsx)**. Download the whole workbook to include the hidden helper tabs.
2. Open the new app and choose **Data & backups**.
3. Select the `.xlsx` file and click **Review import**. Check the counts, sample records and any warnings.
4. Click **Import this collection**. Imports are transactional and a retry of the same file does not add it twice.

A workbook imports `Sheet1`, `_BookAppTrash`, `_BookAppReleases`, and `_BookAppSeriesCatalogs` when present. This carries over owned books, Recently removed, saved releases, and selected publisher category links. It copies cell values; spending summaries are calculated in the app. Choices are rebuilt from your records plus the existing standard type/status choices. Unused spreadsheet dropdown choices are not included in Excel exports read by this importer.

Your existing columns remain the import contract:

| ISBN | Series | Type | Publisher | Status | Volume | Source | Price | Date | Note |
| ---- | ------ | ---- | --------- | ------ | ------ | ------ | ----- | ---- | ---- |

The importer preserves intentional duplicate copies, fractional volumes, zero prices for gifts and blank prices for unknown amounts. It expands safely representable scientific-notation ISBNs and reports a warning for review. Invalid legacy ISBNs are kept and flagged; barcode ownership checks cannot match those until corrected. Notes beginning with `=` remain literal text.

CSV and JSON arrays also import owned books. CSV dates must be `YYYY-MM-DD`; use `.xlsx` to carry over spreadsheet date cells without ambiguity. A complete app JSON backup also restores removed books, saved releases, catalog links and unused dropdown choices.

Imports require an empty library to avoid confusing intentional second copies with records already imported. For a fresh local database, use a different database path:

```sh
BOOKS_DATABASE_PATH=./data/current-collection.sqlite npm run import -- collection.xlsx --preview
BOOKS_DATABASE_PATH=./data/current-collection.sqlite npm run import -- collection.xlsx
BOOKS_DATABASE_PATH=./data/current-collection.sqlite npm run dev
```

Importing never writes to or changes the Google Sheet. Once the latest workbook is imported, use the new app for ongoing collection changes. The sheet and standalone database do not automatically synchronize.
