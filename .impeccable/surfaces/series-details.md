---
version: 1
slug: series-details
primary_target: components/collection/SeriesInfoPanel.tsx
related_targets:
  [
    app/styles/series-info.css,
    components/VolumeDetail.tsx,
    components/collection/SeriesEditor.tsx,
    components/collection/dialogs/BookDialog.tsx,
    app/styles/volume-editor.css,
  ]
---

Mode: Operate. Extend the existing series view, preserving collection editing, themes, language choices and source matching.

## Direction contract

THESIS: A dense, source-backed manga record, inspired by the supplied MangaDex reference rather than a spacious dashboard. Every known fact stays accessible; unknown data is not invented.

OWN-WORLD: Preserve meemai's system typography, cool paper, graphite and cobalt links, compact corners, flat dividers, and both themes. Publisher artwork and book covers supply the visual identity.

STORY: Identify a work, inspect its creators, tags and publication facts, browse related titles, compare language editions, and open individual volumes. Submit corrections into a persistent review queue without modifying current metadata.

FIRST VIEWPORT: A shallow publisher banner above a cover-and-title row, compact existing collection actions, then jump links. A narrow fact, alternate-title and edition column sits beside the synopsis and volume records, eliminating the empty lower half of a sequential profile. Handheld stacks synopsis, metadata and volumes without hiding information.

FORM: User-pinned reference composition, local extension of the established utility. No concept roll; seed: none (user-pinned). Signature interaction: source-attributed metadata becomes browse links, with separate correction review and owned-copy editing.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Finish evidence

### Revised-edition extension

Keep the existing Operate surface and visual system. A compact notice by the series title jumps to explicitly labeled revised editions in an always-visible, source-linked list beside the series catalog results, even for a complete shelf. Preserve publisher titles and ISBNs; distinguish alternatives from missing volumes and leave owned records and matching rules untouched. Exclude unrelated category variants and sets from this section. Verify English/Thai copy, handheld/desktop layouts and stale/empty catalog states.

The independent finish review returned `ship` for this extension after inspecting desktop light, handheld light/dark and handheld Thai captures. The isolated feature passed the production build, formatting, type checking, all 565 unit/integration tests and the revised-edition browser scenario; the full browser suite also passed. Existing DESIGN.md and its sidecar are unchanged; detector advisories concern pre-existing CSS values outside the changed rules. No shipping raster assets were added.

The independent finish review returned `fix`; its verdict pass returned `ship` with all three listed findings resolved: visible handheld export/edit labels, consistent sourced availability, and matching handheld DOM/visual order. This verdict covers those fixes, not a new whole-surface audit.

Verified production build, formatting, all 544 unit/integration tests (serialized after a concurrency-sensitive cache test), and browser scenarios for detailed series records, existing title/synopsis selection, series editing and volume entry. Captures cover 1440px and the reference's 1456px desktop width, 390px handheld, light/dark themes, the suggestion form and individual volume pages. Existing editing checks also cover 320px overflow and the persistent save bar.

Compared the extension against DESIGN.md's system typography, cobalt actions, theme variables, flat divided records and handheld controls; DESIGN.md and its sidecar remain unchanged. No new shipping raster files: publisher banners/covers use authenticated image storage and retain source URLs. README documents the workflows and explicitly separates operational suggestions from library exports.

### Volume editing extension

Operate, preserving the existing visual system but prioritizing usable editing over the old dialog-width constraint. Edit volumes now owns the full content width: a review table on desktop and labeled stacked records on phones. Selecting a volume opens all edition, reading, purchase and metadata fields in a three-section dialog. Done retains the draft; Reset this volume restores its original values; the table saves all drafts atomically. Publisher metadata stays read-only for ordinary accounts. Owned-cover editing uses a separate three-column desktop composition; handheld actions remain persistent and track the available viewport.

The in-thread finish review inspected English/Thai, light/dark, desktop and handheld captures, including a read-only local copy of all 180 books across 41 real series. Recorded fields fit without scrolling at 1280×720, 1366×768 and 1440×900. The seven-width all-route check reported no overflow, clipped controls, undersized controls or crowded dropdowns. Chromium/WebKit editing checks, the production browser suites, administrator/preferences/multi-user checks, scanner fixtures, build/type/format checks and all 578 serialized unit/integration tests passed. The changed-target detector reported no findings. Physical-device and live-provider limits, plus a pre-existing parallel cache-test flake, are documented in docs/ui-review.md. DESIGN.md records the wider volume-editor exception; no shipping raster assets were added.
