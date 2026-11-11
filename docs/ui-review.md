# Desktop and handheld UI review

Reviewed on 11 November 2026, preserving the existing collection-utility design.

## Coverage

- All 15 page routes: collection, search, missing volumes, releases, discovery,
  statistics, removed books, series, settings, data/backups, administration,
  login, account re-linking, terms and privacy; also the not-found state.
- Widths: 320, 390, 560, 760, 768, 1024 and 1440 CSS pixels. Signed-in library
  pages and all six administration sections are checked in light and dark themes.
- Expanded filters, selection, merging/removal confirmations, book entry,
  scanning, ownership checks, ISBN linking, title editing, volume editing and
  account-management forms.
- Shared dropdown viewport containment and dismissal, touch-sized controls,
  readable handheld fields, local field clipping and long mixed Thai/English
  series names. Existing interaction scenarios also cover touch, keyboard,
  editable suggestions, saving and cancellation.

Controls retain the existing shared CSS system and `components/Dropdowns.tsx`
enhancement; native elements remain the form-value and no-JavaScript fallback.

## Corrections

- Series actions no longer overlap long handheld titles. Export remains named
  accessibly when its visible label becomes an icon.
- Administration headers wrap within narrow screens; filters inherit shared
  field styling, 48px height and 16px text. Tables scroll inside their containers.
- Text actions, statistics switches, ownership actions, checkbox labels and file
  controls follow the shared touch-target minimum.
- Handheld settings/data sections no longer place content against side borders.
- Dropdowns do not depend on the newer `checkVisibility()` API, which shipped
  after popovers in Safari. The regression check removes this API deliberately.
- The debugger's search-mode dropdown has an explicit, translated accessible name.
- Light-theme warning text now has 4.58:1 contrast on its warning background
  (previously 4.33:1); the recorded token in `DESIGN.md` matches.

## Repeat the check

```sh
npm run build
BOOKS_TEST_DATABASE_URL=postgresql://localhost/books_test npm run test:ui
```

The test creates and removes its own isolated PostgreSQL schema. Screenshots and
the machine-readable findings are saved to `outputs/ui-consistency/`.

The final UI matrix reports no document overflow, clipped fields, undersized
control targets or title/action collisions. The UI suite, production build,
formatting checks, 164 unit tests and account-preferences browser suite pass.

The broader `test:e2e` run stops in `publisher-isbn-search.browser.mjs` waiting for
a Yaakz result. `test:admin` reaches a separate provider-registry assertion where
the expected Luckpim title-search provider is absent. These remain unresolved;
publisher/provider backend behavior was not changed by this review.
The separate title-details scenario also fails its edition-language-retention
assertion; its rendered controls and layout are covered by the UI matrix, but
that data-preservation behavior is not certified by this review.

Evidence is from headless Chromium with emulated viewports and synthesized touch,
not physical phones or Safari. Hardware keyboards, mobile browser chrome, camera
permissions and real virtual keyboards still need device testing. The source
detector reports advisory legacy/overridden type and radius values; those are not
proof of rendered defects and were not normalized as part of this refinement.
