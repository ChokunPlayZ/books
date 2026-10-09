# Book Collection

A standalone **Next.js 16 app with SQLite**, ready for Docker self-hosting. It preserves the collection interface and its existing workflows while storing your library in a database. Apps Script and Google Sheets are no longer required at runtime.

The local database in this workspace was initialized from the existing **150-book snapshot** in `preview/books.json`. This is a copy of that snapshot, not a live read of the current Google Sheet. A new Docker deployment starts empty so you can import the latest workbook.

## Run locally

Use Node.js **22.16 or newer** (Node 24 is used in Docker).

```sh
npm ci
npm run dev
```

Open <http://localhost:3000>. Books persist in `data/books.sqlite` across restarts. Local development allows access without a password unless `BOOKS_PASSWORD` is set. The development server listens on loopback.

To initialize a fresh local database from the included snapshot:

```sh
npm run import -- preview/books.json --preview
npm run import -- preview/books.json
```

To run the production build locally over HTTP:

```sh
npm run build
BOOKS_PASSWORD='your-long-private-password' BOOKS_SECURE_COOKIES=false HOSTNAME=127.0.0.1 npm start
```

The build prepares a complete standalone Next.js bundle, including its static assets. Start, import and backup commands load the project’s `.env` / `.env.local` configuration and keep relative database paths anchored to the workspace. Production requires a password unless `BOOKS_ALLOW_UNAUTHENTICATED=true` is explicitly configured for a private environment.

## Self-host with Docker

Copy `.env.example` to `.env`, set `BOOKS_PASSWORD` to a long private password, then run:

```sh
cp .env.example .env
# Edit .env and set BOOKS_PASSWORD.
docker compose up -d --build
```

The app listens on port 3000 and stores its database in the persistent `books-data` volume. Compose publishes the port on `127.0.0.1`; put your existing reverse proxy in front of it for remote access. Use HTTPS and leave `BOOKS_SECURE_COOKIES=true` for a hosted installation. If you are testing only over local HTTP, set `BOOKS_SECURE_COOKIES=false`.

Use one app instance with its local SQLite volume. Update with `docker compose up -d --build`; the database is retained. `/api/health` checks the database connection without returning library data. The image runs as an unprivileged user.

Live camera access requires HTTPS or localhost. Taking or choosing barcode photos still uses the same local browser decoder and text recognition.

## Move your current Google Sheet

1. In your collection sheet, choose **File → Download → Microsoft Excel (.xlsx)**. Download the whole workbook to include the hidden helper tabs.
2. Open the new app and choose **Data & backups**.
3. Select the `.xlsx` file and click **Review import**. Check the counts, sample records and any warnings.
4. Click **Import this collection**. Imports are transactional and a retry of the same file does not add it twice.

A workbook imports `Sheet1`, `_BookAppTrash`, `_BookAppReleases`, and `_BookAppSeriesCatalogs` when present. This carries over owned books, Recently removed, saved releases, and selected publisher category links. It copies cell values; spending summaries are calculated in the app. Choices are rebuilt from your records plus the existing standard type/status choices. Unused spreadsheet dropdown choices are not included in Excel exports read by this importer.

Your existing columns remain the import contract:

| ISBN | Series | Type | Publisher | Status | Volume | Source | Price | Date | Note |
|---|---|---|---|---|---|---|---|---|---|

The importer preserves intentional duplicate copies, fractional volumes, zero prices for gifts and blank prices for unknown amounts. It expands safely representable scientific-notation ISBNs and reports a warning for review. Invalid legacy ISBNs are kept and flagged; barcode ownership checks cannot match those until corrected. Notes beginning with `=` remain literal text.

CSV and JSON arrays also import owned books. CSV dates must be `YYYY-MM-DD`; use `.xlsx` to carry over spreadsheet date cells without ambiguity. A complete app JSON backup also restores removed books, saved releases, catalog links and unused dropdown choices.

Imports require an empty library to avoid confusing intentional second copies with records already imported. For a fresh local database, use a different database path:

```sh
BOOKS_DATABASE_PATH=./data/current-collection.sqlite npm run import -- collection.xlsx --preview
BOOKS_DATABASE_PATH=./data/current-collection.sqlite npm run import -- collection.xlsx
BOOKS_DATABASE_PATH=./data/current-collection.sqlite npm run dev
```

Importing never writes to or changes the Google Sheet. Once the latest workbook is imported, use the new app for ongoing collection changes. The sheet and standalone database do not automatically synchronize.

## Preserved workflows

- Browse by series, search, filter, and see all owned volumes in an edition.
- Add books or use the short **Add volume** form with recent series defaults.
- Edit reading status and purchase details; calculate percent/amount discounts.
- Remove and restore books through **Recently removed**.
- Scan ISBNs from photos or a live camera, recognize printed ISBNs, and use a USB/Bluetooth barcode scanner.
- Check ownership by equivalent ISBN-10/ISBN-13 and link ISBNs to existing volumes.
- Show edition-specific whole-volume shelf gaps without inventing fractional extras.
- Check full series catalogs, choose publisher categories, and review uncertain editions or special sets.
- Browse Phoenix Next, First Page Pro and Luckpim releases; filter manga/light novels and special editions; save releases for later.
- Look up exact ISBN metadata using Naiin, then Google Books and Open Library.

Publisher requests run on the Next.js server using native asynchronous fetch. Catalog results are cached in SQLite; failed refreshes retain the previous successful result with its original check time and a stale warning. Catalog checks remain independent of recent release listings. Photos are decoded on the device and never uploaded to the app or metadata providers.

## Backups and restoration

Choose **Data & backups → Download library backup**. The JSON file contains owned books, removed books, saved releases, catalog links and dropdown choices. Download it regularly and keep a copy outside the server.

The command-line equivalent is:

```sh
npm run backup -- /path/to/book-collection-backup.json
```

To restore, import that backup into an empty database through the UI or CLI. Record IDs and revision tokens are regenerated during restoration; the library records are preserved. A logical export uses one database transaction for a consistent snapshot. It excludes login sessions, request receipts and disposable catalog caches.

For a raw database backup, stop the container before copying its volume, or use SQLite's backup facility. Do not copy only `books.sqlite` while the app is writing: committed changes can still be in its WAL file. Keep the Docker volume when updating; deleting the volume deletes the library.

## Development and verification

```sh
npm test
npm run build
npm run test:e2e
```

`npm test` covers the new SQLite storage, transactional retries, stale edits, migration/restore, authentication and Node scrapers, plus the original regression checks. Scanner unit tests now use the standalone production browser code.

`npm run test:e2e` starts isolated production Next.js instances with temporary SQLite databases. It checks sign-in, protected APIs, file review/import, saved records after reload, backups and logout, then runs the existing pricing, series entry, missing-volume, publisher and release-filter UI regressions against Next.js. It does not modify your local library. Install a Playwright browser with `npx playwright install chromium`, or pass `--browser-executable=/absolute/path/to/chromium` to use an existing one.

For the three barcode/OCR photo fixtures and camera cancellation checks:

```sh
npm run test:e2e -- --scan-photos
```

Photo tests require internet access for the same pinned decoder/OCR libraries used by the app. Test screenshots have `outputs/next-` filenames so the earlier Apps Script previews remain intact.

The native production build and automated checks have been verified. The Docker build could not be exercised on this machine because its Docker daemon was stopped.

## Source layout

- `app/`: Next.js App Router pages and same-origin API route handlers.
- `components/`: server-rendered collection shell and React import/backup interface.
- `public/collection.js`: preserved collection interaction, scanning, pricing, and catalog comparison controller; uses `/api/rpc`.
- `lib/domain.mjs`: ISBN, validation, parsing and catalog matching rules.
- `lib/server/store.mjs`: SQLite schema, durable records, transactions, request receipts, revision checks and logical backups.
- `lib/server/catalogs.mjs`: asynchronous publisher/ISBN fetches and durable caches.
- `lib/server/importer.mjs`: workbook, CSV and JSON migration.
- `lib/server/auth.mjs`: password sign-in, expiring sessions and login rate limits.
- `scripts/`: import, backup and standalone packaging commands.
- `tests/app/`: standalone backend and production-browser tests.

The prior Apps Script source remains in `apps-script/` for reference and rollback. Its complete previous documentation is preserved in [docs/apps-script-legacy.md](docs/apps-script-legacy.md). The [scraper maintenance guide](docs/web-scraping.md) still describes the source extraction rules; see its standalone runtime section for the new implementation.

Next.js setup follows the [official App Router documentation](https://nextjs.org/docs/app). SQLite uses the [Node.js SQLite API](https://nodejs.org/api/sqlite.html); no external database server or native package compilation is needed.
