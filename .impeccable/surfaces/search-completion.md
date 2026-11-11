---
version: 1
slug: search-completion
primary_target: components/collection/UniversalSearch.tsx
related_targets:
  - components/collection/SearchQueryInput.tsx
  - app/styles/search.css
---

# Search completion

Mode: Operate. Extend the existing search field; preserve full-search behavior and the incumbent design system. The user confirmed suggestions belong only to Search everywhere, not book entry.

## Direction contract

THESIS: Complete a collector's query without turning every keystroke into a catalog search. Cached library/catalog names lead; public completion endpoints supplement sparse matches.

OWN-WORLD: Inherit the existing system typography, cool theme surfaces, cobalt focus, compact bordered menus and 44px options. No new decorative language or cover downloads.

STORY: Type a partial name, choose a suggestion or keep free text, then Search/Enter to run the full search. Optional completion outages never obstruct that task.

FIRST VIEWPORT: Keep the existing heading, labeled field and Search button in place. A text-only menu directly beneath the form spans its width; titles wrap and source labels remain secondary. On phones the menu scrolls within the available visual viewport.

FORM: Local extension of the existing search form; no concept round. seed: none (unavailable). The signature interaction is immediate cached matches followed by debounced, cancellable completion updates.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Finish review

The independent review requested one fix: asynchronous completion publications could clear a keyboard-highlighted option. Selection now follows the option's value across cached replays and reordered provider responses. Browser regressions cover both cases, ensuring Enter fills the selected query without submitting it. The reviewer's verdict pass scored that finding **resolved — ship at this finding's scope**.

Verified the production build, type checks, formatting and all 559 unit/integration tests. The isolated production search browser scenario covers cached reuse, progressive completion, cancellation, optional failures, ISBN exclusion, keyboard/pointer/IME behavior and overflow through 320px. Recaptures show the open menu and active option at 1440px light and 390px light/dark; transitions were disabled for stable evidence.

Compared against DESIGN.md and the incumbent search captures: typography, theme tokens, touch targets and compact bordered menus are preserved. The detector's new 5px radius advisory matches the existing shared dropdown option; its 11px font advisory concerns an unchanged search-result rule. DESIGN.md and its token sidecar remain unchanged. README.md and docs/web-scraping.md document the workflow, source endpoints, cache policy and privacy boundaries. No shipping raster assets were created.
