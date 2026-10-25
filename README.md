# Book Collection

A personal book library built with Next.js 16, TypeScript, Tailwind CSS 4 and SQLite. Track volumes, purchases and reading status, scan ISBNs, compare publisher catalogs, find the lowest book prices and keep backups. The application is self-contained and can run locally or in Docker.

## Start developing

Use Node.js **22.18 or newer**. Docker uses Node 24.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). Next.js compiles the TypeScript, watches changes and refreshes the browser. There is no separate browser-script build step. An empty database is created at `data/books.sqlite`; an existing database is never reseeded or replaced.

To try the sample collection in a separate database:

```sh
BOOKS_DATABASE_PATH=./data/sample.sqlite npm run import -- tests/fixtures/collection.json --preview
BOOKS_DATABASE_PATH=./data/sample.sqlite npm run import -- tests/fixtures/collection.json
BOOKS_DATABASE_PATH=./data/sample.sqlite npm run dev
```

## Everyday commands

| Command                                       | Purpose                                                   |
| --------------------------------------------- | --------------------------------------------------------- |
| `npm run dev`                                 | Start development with automatic refresh                  |
| `npm run check`                               | Type checks, formatting checks and unit/integration tests |
| `npm run format`                              | Format source, tests and documentation                    |
| `npm test`                                    | Run unit and SQLite integration tests                     |
| `npm run build`                               | Create the production standalone server                   |
| `npm start`                                   | Start the production build                                |
| `npm run test:e2e`                            | Run browser scenarios against temporary databases         |
| `npm run test:docker`                         | Check a disposable Docker deployment                      |
| `npm run import -- collection.xlsx --preview` | Review an import                                          |
| `npm run backup -- backup.json`               | Export a library backup                                   |

Browser tests need a production build and Playwright’s browser:

```sh
npm run build
npx playwright install chromium
npm run test:e2e
```

An installed browser can be selected with `--browser-executable=/absolute/path/to/chromium`. Add `--scan-photos` to test photo scanning; those checks download the pinned barcode/OCR libraries. Screenshots are written under `outputs/`. Tests never use the normal library database.

## Find the relevant code

| Location                              | Responsibility                                                              |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `app/`                                | Next.js pages, authentication gates and HTTP routes                         |
| `components/collection/`              | Collection panels and individual dialogs                                    |
| `components/CollectionController.tsx` | Mount/unmount the browser controller                                        |
| `lib/client/`                         | Collection behavior, pure matching rules and scanner lifecycle              |
| `lib/domain/`                         | ISBNs, validation, HTML parsing, publisher URLs and catalog normalization   |
| `lib/server/`                         | SQLite storage, authentication, catalog fetching, imports and stored images |
| `lib/types.ts`                        | Shared book, release and import data types                                  |
| `app/styles/`                         | Tailwind component styles grouped by feature                                |
| `tests/unit/`                         | Pure rules and scanner behavior                                             |
| `tests/integration/`                  | Real SQLite and catalog-service regressions                                 |
| `tests/browser/`                      | Production browser scenarios and their runner                               |
| `tests/fixtures/`                     | Stable publisher responses, photos and sample collection                    |

See the [development guide](docs/development.md) for module boundaries and common changes, [library workflows](docs/library.md), [import formats](docs/imports.md), [self-hosting and backups](docs/self-hosting.md), and [publisher maintenance](docs/web-scraping.md).
