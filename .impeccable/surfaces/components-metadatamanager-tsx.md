---
version: 1
slug: "components-metadatamanager-tsx"
primary_target: "components/MetadataManager.tsx"
related_targets:
  ["app/styles/metadata.css", "app/data/page.tsx", "components/DataManager.tsx"]
---

# Metadata and cache maintenance

Mode: Operate. Scope: extension of Data & backups, primarily components/MetadataManager.tsx, app/styles/metadata.css, and app/data/page.tsx.

User request: add metadata management, purge cache, re-crawl etc. Confirmed scope: cached sources plus optional filling of missing fields on owned books.

THESIS: A collector can inspect stored source data and deliberately refresh or purge it without damaging their collection.
OWN-WORLD: Inherit DESIGN.md's cool neutrals, graphite text, cobalt actions, system typography and flat divided utility sections. Respect both themes and handheld controls.
STORY: See cache counts and metadata gaps, choose sources and optionally fill blank ISBN metadata, run and stop a sequential queue, inspect cached text, then purge one record or the filtered set. Backups stay accessible below.
FIRST VIEWPORT: Preserve the brand header and Data & backups heading, library counts, and add two section links. A Metadata & cache heading leads into inline cache counts, followed by source selectors, an optional fill checkbox and explicit re-crawl action. Handheld fields stack at 600px. Cache filters, records and backup/import content follow in the same page.
FORM: Native utility extension in the existing world. Local feature scope requires no concept tournament or new seed; the inherited design direction records seed 4270928b. Signature interaction is the sequential, stoppable queue with per-source outcomes. No decorative motion.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Constraints: preserve existing book values, manual details, duplicate copies, stored images, saved releases, links, authentication, same-origin checks and retry cooldowns. Queue operates while the page is open. No authored raster assets. Existing DESIGN.md and .impeccable/design.json should be preserved unless the finished extension establishes an approved system change.
