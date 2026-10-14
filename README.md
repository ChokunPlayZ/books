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

Install Docker with the Compose plugin. Copy `.env.example` to `.env` and set `BOOKS_PASSWORD` to a long private password, then start the app:

```sh
cp .env.example .env
# Edit .env and set BOOKS_PASSWORD.
docker compose up -d --build --wait
```

Open <http://localhost:3000> and sign in with that password. The default cookie setting supports local HTTP. Set `BOOKS_PORT` in `.env` to use a different host port.

The database lives in the persistent `books-data` volume. A fresh deployment starts empty; import your workbook or backup from **Data & backups**. Use one app instance with its local SQLite volume. Update with `docker compose up -d --build --wait`; the database is retained. Stop with `docker compose down`. **Do not add `--volumes` when stopping your installation:** that deletes the library.

Compose publishes on `127.0.0.1` by default. For remote access, put your HTTPS reverse proxy in front of the app and set `BOOKS_SECURE_COOKIES=true`. Change `BOOKS_BIND_ADDRESS` only if your proxy needs another host interface, and preserve the original `Host` header when forwarding requests.

The image uses Node.js 24, a multi-stage build and the standalone Next.js bundle, runs as an unprivileged user, and excludes local databases, environment files and backups from the build context. `/api/health` checks the database connection without returning library data. Compose waits for the health check and allows 30 seconds for graceful shutdown. View status with `docker compose ps` and logs with `docker compose logs -f books`.

To build an image without Compose:

```sh
docker build -t book-collection .
docker run -d --name book-collection --init \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  -e BOOKS_DATABASE_PATH=/app/data/books.sqlite \
  -v books-data:/app/data \
  book-collection
```

Compose uses a project-prefixed volume name; the standalone command uses a separate volume named `books-data`.

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
- Edit series name, type and publisher from **Edit title details** on the title page. Changes apply to every owned volume in the matching edition; separate editions keep their own type and publisher. Volume forms inherit these details and let you select an existing edition or add another one.
- Edit reading status and purchase details; calculate percent/amount discounts.
- Remove and restore books through **Recently removed**.
- Scan ISBNs from photos or a live camera, recognize printed ISBNs, and use a USB/Bluetooth barcode scanner.
- Check ownership by equivalent ISBN-10/ISBN-13 and link ISBNs to existing volumes.
- Show whole-volume shelf gaps by publisher and language, combining colored and regular manga without inventing fractional extras.
- Count regular and single-volume special editions toward the same volume; group alternate listings for missing volumes and review multi-volume sets separately.
- Check full series catalogs, choose publisher categories, and review uncertain editions. Automatic publisher results skip Special Set listings, including Thai special-set labels.
- Browse Phoenix Next, First Page Pro, Luckpim and Siam Inter Comics (Yaakz) releases; filter manga/light novels and special editions; save releases for later.
- Use **Discover titles** to browse Phoenix Next or First Page Pro’s navigation, or Yaakz’s product catalog, including Phoenix GL and each publisher’s full title directory. Titles with any owned volume are hidden; each remaining title shows one representative book, preferring regular volume 1.
- See covers on series, owned volumes, missing catalog volumes and releases. Covers load as needed from publisher catalogs or verified ISBN metadata, with a placeholder when no image is available.
- Open a volume’s three-dot menu to edit metadata, change its cover, or visit the publisher. **Pull covers** reads matching editions and their product galleries from Phoenix Next, First Page Pro, Luckpim and Yaakz, and checks Naiin and Yaakz bookstore listings; select an image and save. You can also enter a supported image URL and publisher product link. Choices are stored per copy, survive refreshes and restarts, and travel with JSON backups. Clear the image URL to return to automatic covers.
- Look up exact ISBN metadata using Naiin, Yaakz, then Google Books and Open Library.

Publisher requests run on the Next.js server using native asynchronous fetch. Catalog results are cached in SQLite; failed refreshes retain the previous successful result with its original check time and a stale warning. Catalog checks remain independent of recent release listings. Photos are decoded on the device and never uploaded to the app or metadata providers.

Discovery reads the publisher’s navigation first, then checks title categories as their cards come into view (at most three checks concurrently). Duplicate format links share one title card. Directories and title catalogs are reused for 24 hours and retained for seven days; **Refresh titles** checks them again. When volume 1 is absent, the card identifies the available volume. Publisher navigation can contain categories without current book listings; these remain visible with a category link. Cover images are validated and stored as image bytes in SQLite, with a permanent content-based `coverId`. The browser loads `/api/covers/<id>` through the signed-in library; image requests read the database without contacting publishers. Identical images share one ID. Saved images survive restarts and source outages, and JSON backups include their bytes. Existing files in the old `covers/` directory migrate into SQLite when their source is next used. Cover matching and source lookups run on the server; the browser has no cover cache or catalog-matching rules. Standard private browser caching uses immutable IDs and ETags.

Yaakz provides paginated public product data and Nuxt product details. Products containing several volumes are expanded into their individual variants, each with its own ISBN, image and product URL; a parent range image is never assigned to every volume. Bookstore covers require an exact ISBN, or a matching series, volume, publisher/format where available. Cover choices show their source, and source failures leave successful choices available.

## Backups and restoration

Choose **Data & backups → Download library backup**. The JSON file contains owned books, removed books, saved releases, catalog links, dropdown choices and stored cover images. Download it regularly and keep a copy outside the server.

The command-line equivalent is:

```sh
npm run backup -- /path/to/book-collection-backup.json
```

To restore, import that backup into an empty database through the UI or CLI. Record IDs and revision tokens are regenerated during restoration; the library records are preserved. A logical export uses one database transaction for a consistent snapshot. It excludes login sessions, request receipts and disposable catalog caches.

For a raw database backup, stop the container before copying its volume, or use SQLite's backup facility. Do not copy only `books.sqlite` while the app is writing: committed changes can still be in its WAL file. Keep the Docker volume when updating; deleting the volume deletes the library.

## Development and verification

The collection browser supports type, reading status, publisher, store, ISBN and price availability, amount-paid ranges, and inclusive purchase-date ranges. Open **More filters & sorting** to sort series by total spending, book count, or most recent purchase. Filters match the same individual book, and series counts and spending reflect only matching books. Opening a series clears filters to show all owned volumes; its volumes can then be filtered or sorted separately.

**Collection spending** shows the most expensive series by total amount paid, the store with the most spending, and the top five of each. These summaries use the whole current collection regardless of browser filters. Removed books and missing prices are excluded; zero prices are included, and purchases without a store are reported separately from store rankings. **Bought from** stays visible and editable when adding volumes to an existing series.

```sh
npm test
npm run build
npm run test:e2e
npm run test:docker
```

`npm test` covers the new SQLite storage, transactional retries, stale edits, migration/restore, authentication and Node scrapers, plus the original regression checks. Scanner unit tests now use the standalone production browser code.

`npm run test:e2e` starts isolated production Next.js instances with temporary SQLite databases. It checks sign-in, protected APIs, file review/import, saved records after reload, backups and logout, then runs the existing pricing, series entry, missing-volume, publisher and release-filter UI regressions against Next.js. It does not modify your local library. Install a Playwright browser with `npx playwright install chromium`, or pass `--browser-executable=/absolute/path/to/chromium` to use an existing one.

For the three barcode/OCR photo fixtures and camera cancellation checks:

```sh
npm run test:e2e -- --scan-photos
```

Photo tests require internet access for the same pinned decoder/OCR libraries used by the app. Test screenshots have `outputs/next-` filenames so the earlier Apps Script previews remain intact.

`npm run test:docker` requires a running Docker engine. It builds the image in a disposable Compose project, checks health, sign-in, static assets and Excel import, then recreates the container to verify that books and sessions survive. It removes only its own test containers, image and volume when finished; your normal Compose installation is separate.

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
