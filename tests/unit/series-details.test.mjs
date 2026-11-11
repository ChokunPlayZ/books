import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  phoenixSeriesMetadata,
  phoenixSeriesUrl,
  structuredPublicationFacts,
} from "../../lib/domain/series-sources.ts";
import { mergeSeriesMetadata } from "../../lib/domain/series-info.ts";
import { parseAnimeMedia } from "../../lib/domain/anime.ts";
import {
  editionLanguage,
  formatMoney,
  volumePath,
  metadataBrowsePath,
} from "../../lib/domain/series-detail.ts";

test("Phoenix series pages retain the real banner, creators, tags, titles and publication facts without shop chrome", () => {
  const html = readFileSync(
    new URL(
      "../fixtures/publishers/phoenix-series-profile.html",
      import.meta.url,
    ),
    "utf8",
  );
  const profile = phoenixSeriesMetadata(
    html,
    "https://www.phoenixnext.com/series/icecreamkanojo",
  );
  assert.equal(profile.images.length, 2);
  assert.match(profile.images[0].url, /_M_Icecream_Kanojo_KVEC.jpg$/);
  assert.equal(
    profile.facts.find((fact) => fact.label === "Author").value,
    "Kuunerin",
  );
  assert.equal(
    profile.facts.find((fact) => fact.label === "Age rating").value,
    "13+",
  );
  assert.equal(profile.tags[0].name, "Romance");
  assert.equal(profile.titles.length, 4);
  assert.ok(
    profile.titles.some(
      (title) =>
        title.language === "ja-Latn" && title.title === "Icecream Kanojo",
    ),
  );
  assert.doesNotMatch(
    profile.synopses[0].text,
    /Review|payment|รีวิว|รวมมังงะ/,
  );
  assert.match(profile.synopses[0].text, /\n/);
  for (const url of [
    "http://www.phoenixnext.com/series/a",
    "https://www.phoenixnext.com.evil.test/series/a",
    "https://localhost/series/a",
    "https://user:pass@www.phoenixnext.com/series/a",
    "https://www.phoenixnext.com/a.html",
    "https://www.phoenixnext.com:444/series/a",
  ])
    assert.equal(phoenixSeriesUrl(url), "");
  assert.throws(
    () =>
      phoenixSeriesMetadata(
        "<nav>No details</nav>",
        "https://www.phoenixnext.com/series/test",
      ),
    /unavailable/,
  );
});

test("sourced facts are text-only, image hosts are allowlisted and verified structured products never borrow recommendation authors", () => {
  const profile = mergeSeriesMetadata({
    facts: [
      {
        label: "Author",
        value: "<b>Creator</b><script>alert(1)</script>",
        source: "Publisher",
        url: "https://example.com/book",
      },
      { label: "Unsafe", value: "x", source: "X", url: "javascript:alert(1)" },
    ],
    images: [
      {
        kind: "banner",
        url: "https://evil.test/a.jpg",
        source: "X",
        sourceUrl: "https://example.com/book",
      },
    ],
  });
  assert.equal(profile.facts.length, 1);
  assert.equal(profile.facts[0].value, "Creator");
  assert.equal(profile.images, undefined);
  const html = `<script type="application/ld+json">${JSON.stringify([
    { isbn: "9784063951370", author: { name: "Correct" } },
    { isbn: "9781975325746", author: { name: "Recommendation" } },
  ])}</script>`;
  assert.equal(
    structuredPublicationFacts(
      html,
      "Publisher",
      "https://example.com/book",
      "9784063951370",
    )[0].value,
    "Correct",
  );
});

test("AniList preserves publication details, all staff roles, genres and spoiler-aware tags", () => {
  const media = parseAnimeMedia({
    id: 42,
    type: "MANGA",
    format: "MANGA",
    title: { english: "Synthetic Moon Library" },
    volumes: 6,
    chapters: 32,
    status: "FINISHED",
    startDate: { year: 2019, month: 1 },
    averageScore: 91,
    genres: ["Romance"],
    tags: [
      { name: "School", isMediaSpoiler: false },
      { name: "Ending", isMediaSpoiler: true },
    ],
    staff: {
      edges: [
        { role: "Story & Art", node: { name: { full: "Synthetic Creator" } } },
      ],
    },
  });
  assert.equal(media.facts.find((fact) => fact.label === "Volumes").value, "6");
  assert.equal(
    media.facts.find((fact) => fact.label === "First published").value,
    "2019-01",
  );
  assert.equal(
    media.facts.find((fact) => fact.label === "Story & Art").value,
    "Synthetic Creator",
  );
  assert.equal(
    media.tags.find((tag) => tag.name === "Ending").kind,
    "Spoiler tag",
  );
});

test("detail URLs encode metadata and editions and money distinguishes missing prices from zero", () => {
  assert.equal(formatMoney(0, "JPY"), "JPY 0");
  assert.equal(formatMoney("", "THB"), "");
  assert.equal(
    editionLanguage({ series: "English alias", edition: "(JP)" }),
    "ja",
  );
  assert.match(volumePath("เรื่อง", "owned-1"), /\/volumes\/owned-1$/);
  assert.equal(
    new URL(
      metadataBrowsePath("Author", "A & B"),
      "https://example.com",
    ).searchParams.get("value"),
    "A & B",
  );
});
