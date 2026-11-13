# meemai

Named after the Thai **มีมั้ย** — “Do you have it?”

A personal book library built with Next.js 16, TypeScript, Tailwind CSS 4 and PostgreSQL. Track volumes, purchases and reading status, scan ISBNs, compare publisher catalogs and keep backups. Run locally with PostgreSQL or deploy both services with Docker Compose.

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

Open **User settings** to see your signed-in Google account, username and account role, manage your preferences, or sign out. Choose **English / ไทย** in the library header, or change language and appearance under **Account preferences** in User settings or Data & backups. Language and appearance (light, dark, or device setting) are saved automatically to your account in PostgreSQL and apply on other devices after signing in. Your saved theme is applied before the page paints; another account's browser settings never override it. Book titles, notes and other collection data are not translated or rewritten.

Run `npm run build && npm run test:preferences` for the isolated account-preferences browser checks.

**Data & backups → Export library** downloads only owned books: ISBN, title, type, volume, edition, reading status, purchase source/price/date and notes. It excludes publisher metadata, covers, removed books, saved releases and internal records. Duplicate copies and blank versus zero prices are preserved. Import the JSON into an empty library; use `npm run backup` on the server for a complete backup with covers and saved/removed records.

Cover images are served as cached WebP previews (up to 528 × 740 pixels), with inline BlurHash placeholders while loading. Original images and content IDs remain unchanged for backups. Existing covers are optimized on first access without downloading them again; their placeholders appear on subsequent library loads. Both previews and placeholder metadata retain account-level access checks.

## Universal search

Open **Search** to find a title, publisher, bookshop or ISBN. Your own library, saved titles and previously cached catalog matches appear first, without contacting external sources. Applicable publishers and bookshops are then checked in the background; results are deduplicated and better matches move up as each source responds. Thai queries check Thai publishers and Naiin; English titles also check English catalogs and Google Books. Google Books is excluded from Thai and Japanese title and ISBN lookups. ISBN searches use the existing language-specific lookup providers.

While typing, query suggestions use your library and cached catalog names first. If there are fewer than six distinct matches, debounced completion requests check supported sources: Phoenix Next, Luckpim, Naiin, First Page Pro, Animag and DEXpress. Successful responses, including empty results, are cached for 24 hours; previously discovered names can complete a different query locally. Choose a suggestion with the arrow keys and Enter or by tapping it, then use **Search**/Enter for the full search. Free text remains available, ISBN input skips completion APIs, and typing never crawls product pages or downloads covers.

Searches reuse durable metadata caches, show source failures without hiding other matches, and never add books or change your collection. Private shelves and linked series aliases remain account-specific. External title searches check bounded listing pages, not every volume in a catalog; source details indicate partial coverage.

Outgoing external links include `ref=meemai.ckl.moe` for traffic attribution, preserving destination query parameters and fragments. They allow origin-only browser referrers and keep new tabs isolated with `noopener`; private page paths and queries are not sent to external sites. Attribution is applied only to navigation links, not stored source URLs, backend requests, internal links or downloads.

## Series languages and synopses

Open a series to automatically retrieve publisher/bookstore details and AniList's English, Japanese and romaji titles. Saved information appears immediately while discovery runs. Books without an ISBN can be discovered by their title and edition; saved, supported product links are also checked when ISBN lookup fails. Synopses automatically prefer publishers, then bookstores, with existing catalog descriptions as a final fallback.

Title and synopsis language controls share a compact row when space allows. Series and volume synopses hide standalone divider lines and extra blank lines, and show a source credit unless the text already includes one. Original publisher text and provenance remain stored internally; source selectors and publication-detail attribution stay hidden. You can switch synopsis language or the displayed title without renaming your collection. Display selections are remembered in this browser for your account. **Refresh details** is optional, and ambiguous original-work matches still require confirmation.

Exact original-title matches link automatically, including explicitly labeled romanized names in publisher descriptions. Ambiguous results require **Use this series**. Under **Find or change a series link**, you can also link editions already in your collection or remove an incorrect link. Manga and light novels remain separate, as do each edition's owned volumes and spending. Only source-provided text is used; missing translations are not fabricated. Server backups preserve links and synopsis metadata; the personal library export remains books-only.

The compact series profile displays creators, publication facts, genres and themes without repeated source labels. Click a creator, publisher or tag to browse matching library titles and previously discovered public metadata. Anime adaptations automatically reuse the discovered original title, including for translated shelf names; manual search is tucked under **Change adaptation search**. **Add a publisher series source** remains available for corrections and accepts Phoenix Next `/series/…` pages. Verified Phoenix product pages can also supply an explicit series link automatically. Artwork is stored through the existing authenticated image cache; source URLs remain attached.

Series volumes appear in one cover grid. Owned copies keep their usual styling; missing volumes use an accent outline and a **Missing** label, including shelf gaps and known matching catalog volumes. Select a missing cover to add that edition. Catalog sources, alternate listings and save-for-later actions are available under **Catalog details**.

**Volume details** opens a separate page from a cover for each owned copy and known matching catalog volume. It separates list price, listed store price and your price paid, and includes ISBN, pages, publication facts, personal purchase details, source descriptions and linked language editions. Unknown values remain unrecorded; alternate titles alone do not assert a licensed edition or a complete publication list.

Series catalogs show explicitly labeled **Revised editions** as visible publisher-linked alternatives, even when your shelf has no gaps. These listings do not change owned books or missing-volume counts; unrelated editions and sets remain in the catalog review section.

**Suggest an edit** submits a field, correction, optional HTTPS source and explanation into a persistent review queue. It does not alter the series or your owned copies. Your suggestions and review outcomes remain visible in the menu. Administrators review submissions at **Administration → Metadata suggestions** (`/admin/suggestions`); marking a suggestion reviewed records the outcome only. Apply verified metadata changes separately with the existing metadata tools. Queue records are operational database data, not part of personal library exports.

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
| `npm run test:ui`                             | Check pages, controls and overflow from 320px to 1440px   |
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

See [accounts and privacy](docs/multi-user.md) for adding users, private collection fields, permanent ISBN/source caching and administrator-only maintenance. Administrators have a separate **Administration** workspace at `/admin` for the scraping queue, cache maintenance and read-only system-wide inspection. The page and its navigation are gated on the server; ordinary accounts cannot receive admin components or data. Run `npm run build && npm run test:admin` for the isolated production authorization and queue-control browser checks.

Before public deployment, review [authentication setup](docs/authentication.md) and the [security deployment checklist](docs/security.md).
