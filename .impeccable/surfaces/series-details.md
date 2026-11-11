---
version: 1
slug: series-details
primary_target: components/collection/SeriesInfoPanel.tsx
related_targets: [app/styles/series-info.css, components/VolumeDetail.tsx]
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

The independent finish review returned `fix`; its verdict pass returned `ship` with all three listed findings resolved: visible handheld export/edit labels, consistent sourced availability, and matching handheld DOM/visual order. This verdict covers those fixes, not a new whole-surface audit.

Verified production build, formatting, all 544 unit/integration tests (serialized after a concurrency-sensitive cache test), and browser scenarios for detailed series records, existing title/synopsis selection, series editing and volume entry. Captures cover 1440px and the reference's 1456px desktop width, 390px handheld, light/dark themes, the suggestion form and individual volume pages. Existing editing checks also cover 320px overflow and the persistent save bar.

Compared the extension against DESIGN.md's system typography, cobalt actions, theme variables, flat divided records and handheld controls; DESIGN.md and its sidecar remain unchanged. No new shipping raster files: publisher banners/covers use authenticated image storage and retain source URLs. README documents the workflows and explicitly separates operational suggestions from library exports.
