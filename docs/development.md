# Working on the codebase

## Follow the data flow

Pages and route handlers live in `app/`. Keep them small: check the session, validate the request shape and call the relevant service. `lib/server/app.ts` owns the shared application instance; SQLite records and transactions belong in `lib/server/store.ts`.

Put rules that do not need HTTP or SQLite in `lib/domain/`. The small `lib/domain.ts` file re-exports the public domain API for server callers. Browser code should import the specific browser-safe module it needs, such as `lib/domain/isbn.ts`, so Node-only hashing and storage never enter the client bundle.

The library uses separate server-rendered pages: `/` for the collection, `/series/[series]` for a title’s owned volumes, `/missing` for unowned catalog volumes and shelf gaps grouped by series, `/releases`, `/discover`, and `/removed`. Navigation uses ordinary links and loads a new document, so URLs can be bookmarked and refreshed and browser history works normally. `components/CollectionPage.tsx` checks the session and loads the collection for each page. `CollectionShell.tsx` includes only that route’s panels plus shared dialogs; `ShelfEntries.tsx` renders the initial shelf and volumes on the server. Keep controller-facing IDs stable: `lib/client/elements.d.ts` records the corresponding element types.

Build title links with `seriesPath()` from `lib/domain/navigation.ts`. It encodes arbitrary title names into a URL-safe segment, including Thai text, slashes and percent signs. Release filters and the discovery category are retained in tab session storage across page navigation.

`CollectionController.tsx` loads `mountCollection()` in a browser effect with the page’s view and selected series. The controller progressively adds filtering, editing, catalog checks and scanning to the current page; it does not switch views. It refreshes the initial server data through the same-origin API, and binds controls only when their panel exists. Its cleanup aborts event handlers, stops the scanner and disconnects observers. There are no generated scripts in `public/` and no custom development watcher. `window.bookCollection` exposes the current state and RPC helper for browser diagnostics.

Main result lists use `lib/client/infinite-list.ts` to append batches as the end of the list approaches the viewport. `LIST_BATCH_SIZE` in `lib/domain/lists.ts` also bounds the initial server-rendered shelf, volumes and removed books. Changing filters or sorting starts a new batch; refreshing data keeps the loaded range. Cover and discovery-title lookups observe only rendered rows.

Pure shelf-gap, release matching and discovery grouping rules live in `lib/client/matching.ts` and can be tested without a browser. `lib/client/missing-catalogs.ts` combines unowned catalog listings with shelf gaps without double-counting; `lib/client/missing.ts` checks catalogs with three concurrent requests and displays coverage and stale results. `lib/client/scanner.ts` owns camera, photo and OCR tasks through explicit UI bindings. Keep new pure rules outside the controller where they can be imported directly by tests.

## Make a focused change

- **Change a panel or form:** edit the matching component in `components/collection/`, and its feature stylesheet in `app/styles/`.
- **Change collection behavior:** update `lib/client/collection.ts`; extract reusable calculations into a focused module beside `matching.ts`.
- **Change validation or ISBN handling:** edit `lib/domain/validation.ts` or `isbn.ts`, then add a unit regression.
- **Change storage:** update `lib/server/store.ts` with an additive schema migration and a SQLite integration regression. Never reset an existing database.
- **Add or repair a publisher:** follow [publisher maintenance](web-scraping.md). Test saved fixtures and source outages before checking the live source.
- **Change import/export:** update `lib/server/importer.ts` or the store’s export path; test a round trip including duplicate copies, gifts, blank prices and covers.

Tailwind’s theme is in `app/globals.css`; feature styles use `@apply` and components may use utilities directly. Feature stylesheet imports are ordered to preserve the existing cascade. The application provides its own element defaults instead of Tailwind Preflight.

TypeScript checks every application source. Some inherited parser/controller code still permits implicit parameter types and nullable values in `tsconfig.json`; prefer explicit types for new code and use `unknown` at untrusted boundaries. Shared records belong in `lib/types.ts`.

## Verify the change

Run `npm run check` before finishing. For a UI or route change, also run `npm run build` and `npm run test:e2e`. Browser scenarios are launched directly without rewriting test source. The runner supplies `BOOKS_TEST_URL` and temporary SQLite databases; individual scenarios refuse to run without that test context.

`tests/helpers/library.mjs` creates an in-memory SQLite library and mocked catalog responses for scenarios that need precise fixtures. Pure tests import real TypeScript modules directly. Add coverage for a changed behavior, not for formatting or implementation details.

Formatting is shared through `.prettierrc.json`; run `npm run format` to apply it. Fixtures, local data, build output and screenshots are excluded from formatting. Keep fixture HTML unchanged unless a source regression requires a new snapshot.
