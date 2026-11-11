# Functional and browser testing follow-up

Tested on 11 November 2026 against a fresh production build. All writes used a
new disposable local PostgreSQL database and the existing randomized-schema test
helpers, never the normal library database. Application code was not changed
during the original audit; the subsequent fixes are recorded below.

## Fixes applied — 11 November 2026

- **Edition language:** new-volume defaults, edition selection, missing-volume
  actions and repeated adding preserve the selected language. Same-publisher
  language editions remain separate choices. Only shared language metadata is
  inherited, not another copy's colour variant, notes or purchase details.
- **Catalog comparisons:** language metadata now participates in series catalog
  comparisons and missing-volume grouping, so a Japanese listing cannot become a
  false missing Thai volume after type normalization.
- **Yaakz discovery:** Discover dispatches the publisher ISBN request for Yaakz.
- **Touch dropdowns:** a completed touch pointer gesture opens the menu without
  requiring a compatibility click. A following click cannot toggle it twice;
  movement, cancellation and a second finger cancel the pending tap. Mouse and
  keyboard behavior remain covered.
- **Test repairs:** the scraper stack assertion checks `ScrapeFailure` and retained
  frames; admin provider checks use the combobox's accessible name and wait for
  title-mode options, then exercise Luckpim. The volume-editions fixture seeds the
  server's actual test library and only mocks publisher responses. Fixture browser
  contexts block service workers, while the dedicated PWA scenario still tests
  real workers. The title scenario waits safely across document navigation.

### Verification after fixes

- `npm test`: **513 passed**, no failures or skipped tests.
- `npm run build`, `npm run typecheck`, `npm run format:check`: pass.
- Focused title-details, publisher ISBN, volume-editions, controls, series-entry
  and mobile-adding scenarios: pass in **Chromium and WebKit**.
- `npm run test:admin` and `npm run test:ui`: pass in Chromium.
- The full `npm run test:e2e` is **not passing**: repeated runs stop at the export
  request in `tests/browser/run.mjs` with HTTP 429, “Your library is busy.” An
  isolated-server run got further, but another failed at the same request, so
  server separation was not retained as a claimed fix. The runner now asserts the
  response status before reading the export payload, preserving the real error.
- The additional full WebKit admin run passes the provider checks but still
  times out in the later bulk-edit conflict scenario at
  `tests/helpers/admin-edit-conflicts.mjs:147`. It is not certified as passing;
  this is separate from the repaired Luckpim selector/render timing issue.
- Physical iPhone/Safari, real virtual keyboards and camera permissions remain untested;
  emulated WebKit touch is not physical-device certification.

Fix-verification logs use the `outputs/test-followup/pending-fixes-` prefix. All
verification writes used a new disposable PostgreSQL database with randomized
schemas, not the normal library database.

## Original baseline results

- `npm run build`, `npm run typecheck`, `npm run format:check`: pass.
- `npm test`: 512 passed, 1 failed, no skipped tests.
- `npm run test:ui` (Chromium): pass, including seven widths, light/dark themes,
  pages, admin sections, overlays and interaction scenarios.
- `npm run test:preferences` (Chromium): pass.
- Existing title-details scenario (Chromium and WebKit): fails because a new
  volume does not inherit the selected edition's language.
- Existing publisher ISBN scenario (Chromium and WebKit): fails waiting for a
  Yaakz result in Discover.
- `npm run test:admin` (Chromium): fails at the immediate Luckpim option count;
  focused provider checks succeed.
- WebKit UI matrix: no geometry findings; the subsequent touch scenario fails.
- Mobile adding scenario (WebKit): passes with service workers blocked for
  reliable test routing.
- Focused Luckpim admin scenario (Chromium and WebKit): passes.

The broader end-to-end runner was not certified as passing. Targeted scenarios
were run independently so a discovery failure could not prevent the edition
checks from executing.

## Original confirmed application defects

### 1. New volumes do not inherit their edition language

The title-details scenario reaches its language-retention assertion with a saved
book whose `edition` is empty. The outgoing `saveBook` request already contains
`edition: ""`, so this is not merely a display problem.

The existing Thai and Japanese books retain their language metadata, notes,
purchase sources and prices in that scenario. The affected behavior is adding a
new volume from an existing edition. The rendered gap summary separates the new,
language-less volume from the Thai volumes and reports false missing volumes.

`lib/client/collection.ts` builds edition choices and series defaults using type
and publisher, without copying the selected books' language metadata into the
new-volume form. A separate minimal probe reproduces the empty edition after a
reload in both Chromium and WebKit while confirming the original book's details
remain unchanged. The existing failing regression is
`tests/browser/title-details.browser.mjs`.

### 2. Discover does not dispatch Yaakz ISBN searches

Selecting Yaakz and entering an ISBN produces an empty discovery view. Captured
requests show the preceding Phoenix search, but no `searchPublisherIsbn` call for
Yaakz. The publisher-ID selection inside `renderDiscovery()` in
`lib/client/collection.ts` has no Yaakz branch.

This is distinct from a provider outage: the live backend lookup below succeeds.
The existing failing regression is `tests/browser/publisher-isbn-search.browser.mjs`.

### 3. The shared dropdown does not open on a WebKit touch tap

Both the existing controls scenario and a small isolated browser probe fail when
tapping the Book Entry type selector in headless WebKit. The same probe passes
in Chromium. Mouse clicks and keyboard opening work in both engines.

Captured WebKit events contain the touch and pointer sequence but no following
click, while `lib/client/dropdowns.ts` opens the selector from its click handler.
This is a confirmed emulated-WebKit interaction failure, not proof that every
shipping Safari/device combination is affected. It needs a real Safari/iPhone
check before claiming touch compatibility.

## Provider checks

These were bounded live requests using the existing scraper debugger and an
isolated test store. They are sample checks, not a guarantee of whole-catalog
coverage or future availability.

- **Yaakz**, ISBN `9786165898843`: found the exact ISBN; search API and product
  page both returned HTTP 200.
- **Luckpim**, title `เกมสารภาพรัก`: seven source results; token-handshake and
  search requests both returned HTTP 200.

The rebuilt `getScraperDebugSources` response includes Luckpim with title search
enabled and ISBN search disabled. Focused Chromium and WebKit admin checks wait
for the mode change to render, select Luckpim, submit the correct request and
display the matching provider result.

## Original test-suite issues, not confirmed provider failures

- `tests/integration/scraper-debug.test.mjs` expects `/Error/` in a stack that now
  begins `ScrapeFailure:`. A separate focused check confirms HTTP 503 response
  capture, error details, a retained stack and durable retry cooldowns, with no
  second network request.
- The admin scenario uses an exact `getByLabel("Provider")` selector whose match
  changes after nested options load, and checks `.count()` immediately after a
  React-controlled mode change. The stable, post-render provider check passes;
  the evidence does not support removing or re-registering Luckpim.
- The additional volume-editions scenario seeds an intercepted browser RPC
  store, while the production server renders the series route from another
  store. Navigation reaches a 404. That scenario is blocked by its fixture setup
  and does not establish a new catalog defect.

## Browser limitations and evidence

Chromium and Playwright WebKit were exercised in headless mode. Physical phones,
shipping Safari, real virtual keyboards and actual camera permissions remain
untested. A simulated viewport is not a physical-device certification.

The validated fixture-based WebKit runs block service workers so Playwright's
RPC interception remains effective, matching the existing UI matrix's setup.
Initial unblocked runs allowed real server responses past the fixtures and are
not counted as additional application regressions.

Local diagnostics, request captures, screenshots, traces and test-only probe
scripts are under `outputs/test-followup/` (gitignored). The complete unit and
integration output is `outputs/test-followup/npm-test.log`; live provider
responses are under `outputs/test-followup/live-publishers/`.
