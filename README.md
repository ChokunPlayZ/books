# Book Collection

A personal book library built with Next.js 16, TypeScript, Tailwind CSS 4 and PostgreSQL. Track volumes, purchases and reading status, scan ISBNs, compare publisher catalogs, find the lowest book prices and keep backups. Run locally with PostgreSQL or deploy both services with Docker Compose.

## Start developing

Use Node.js **22.18 or newer**. Docker uses Node 24.

```sh
npm ci
cp .env.example .env.local
# Configure Google sign-in and database credentials in .env.local.
docker compose --env-file .env.local up -d postgres
npm run dev
```

Open [localhost:3000](http://localhost:3000). Next.js compiles the TypeScript, watches changes and refreshes the browser. Set `DATABASE_URL` to your PostgreSQL database; schema migrations run automatically on first connection, without reseeding or replacing existing data. An existing PostgreSQL installation works too (create the database first).

Set up [Google sign-in](docs/authentication.md) in `.env.local` before opening a library. Google is the only sign-in method, including in development; missing credentials never expose the existing collection.

To try the sample collection in a separate PostgreSQL database:

```sh
createdb --maintenance-db=postgresql://books:books-local@localhost:5432/books books_sample
DATABASE_URL=postgresql://books:books-local@localhost:5432/books_sample npm run import -- tests/fixtures/collection.json --preview
DATABASE_URL=postgresql://books:books-local@localhost:5432/books_sample npm run import -- tests/fixtures/collection.json
DATABASE_URL=postgresql://books:books-local@localhost:5432/books_sample npm run dev
```

Upgrading from SQLite? Stop the old app, back up its database, set `DATABASE_URL` to an empty PostgreSQL database, then run `npm run db:migrate:sqlite -- ./data/books.sqlite`. The source is opened read-only; accounts, libraries, preferences, covers and caches are preserved. See [migration and hosting](docs/self-hosting.md).

## Account preferences

Choose **English / ไทย** in the library header, or open **Data & backups → Account preferences**. Language and appearance (light, dark, or device setting) are saved automatically to your account in PostgreSQL and apply on other devices after signing in. Your saved theme is applied before the page paints; another account's browser settings never override it. Book titles, notes and other collection data are not translated or rewritten.

Run `npm run build && npm run test:preferences` for the isolated account-preferences browser checks.

## Universal search

Open **Search** to find a title, publisher, bookshop or ISBN. Your own library, saved titles and previously cached catalog matches appear first, without contacting external sources. Applicable publishers and bookshops are then checked in the background; results are deduplicated and better matches move up as each source responds. Thai queries check Thai publishers and Naiin; English titles also check English catalogs, and Google Books supports multilingual title searches. ISBN searches use the existing language-specific lookup providers.

Searches reuse durable metadata caches, show source failures without hiding other matches, and never add books or change your collection. Private shelves and linked series aliases remain account-specific. External title searches check bounded listing pages, not every volume in a catalog; source details indicate partial coverage.

## Everyday commands

| Command                                       | Purpose                                                   |
| --------------------------------------------- | --------------------------------------------------------- |
| `npm run dev`                                 | Start development with automatic refresh                  |
| `npm run check`                               | Type checks, formatting checks and unit/integration tests |
| `npm run format`                              | Format source, tests and documentation                    |
| `npm test`                                    | Run unit and PostgreSQL integration tests                 |
| `npm run test:unit`                           | Run pure unit tests without a database                    |
| `npm run build`                               | Create the production standalone server                   |
| `npm start`                                   | Start the production build                                |
| `npm run test:e2e`                            | Run browser scenarios against temporary databases         |
| `npm run test:docker`                         | Check a disposable Docker deployment                      |
| `npm run import -- collection.xlsx --preview` | Review an import                                          |
| `npm run backup -- backup.json`               | Export a library backup                                   |

Integration and browser tests require a dedicated PostgreSQL database, never the normal library database. Create it once and export its URL; each test creates and removes a random isolated schema. The test role needs permission to create schemas. Browser tests also need a production build and Playwright’s browser:

```sh
docker compose --env-file .env.local exec postgres createdb -U books books_test
export BOOKS_TEST_DATABASE_URL=postgresql://books:books-local@localhost:5432/books_test
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

An installed browser can be selected with `--browser-executable=/absolute/path/to/chromium`. Add `--scan-photos` to test photo scanning; those checks download the pinned barcode/OCR libraries. Screenshots are written under `outputs/`. Tests never use the normal library database.

## Find the relevant code

| Location                              | Responsibility                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `app/`                                | Next.js pages, authentication gates and HTTP routes                             |
| `components/collection/`              | Collection panels and individual dialogs                                        |
| `components/CollectionController.tsx` | Mount/unmount the browser controller                                            |
| `lib/client/`                         | Collection behavior, pure matching rules and scanner lifecycle                  |
| `lib/domain/`                         | ISBNs, validation, HTML parsing, publisher URLs and catalog normalization       |
| `lib/server/`                         | PostgreSQL storage, authentication, catalog fetching, imports and stored images |
| `lib/types.ts`                        | Shared book, release and import data types                                      |
| `app/styles/`                         | Tailwind component styles grouped by feature                                    |
| `tests/unit/`                         | Pure rules and scanner behavior                                                 |
| `tests/integration/`                  | Real PostgreSQL, migration and catalog-service regressions                      |
| `tests/browser/`                      | Production browser scenarios and their runner                                   |
| `tests/fixtures/`                     | Stable publisher responses, photos and sample collection                        |

See the [development guide](docs/development.md) for module boundaries and common changes, [library workflows](docs/library.md), [import formats](docs/imports.md), [self-hosting and backups](docs/self-hosting.md), and [publisher maintenance](docs/web-scraping.md).

See [accounts and privacy](docs/multi-user.md) for adding users, private collection fields, permanent ISBN/source caching and administrator-only refreshes.

Before public deployment, review [authentication setup](docs/authentication.md) and the [security deployment checklist](docs/security.md).
