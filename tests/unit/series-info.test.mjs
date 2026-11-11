import test from "node:test";
import assert from "node:assert/strict";
import {
  descriptionTitles,
  htmlSeriesMetadata,
  mergeSeriesMetadata,
  seriesAliasesMatch,
  synopsisText,
} from "../../lib/domain/series-info.ts";
import { parseAnimeMedia } from "../../lib/domain/anime.ts";
import {
  scrapedMetadata,
  fillScrapedMetadata,
} from "../../lib/domain/scraped-metadata.ts";

test("publisher descriptions expose labeled original titles, not arbitrary prose mentions", () => {
  const url = "https://example.com/book";
  const titles = descriptionTitles(
    "<p>ชื่อเรื่องต้นฉบับ: 月の図書館</p><p>Romaji: Tsuki no Toshokan</p><p>English title: Moon Library</p><p>Fans of Another Title will love it.</p>",
    "Publisher",
    url,
  );
  assert.deepEqual(
    titles.map(({ title, language }) => [title, language]),
    [
      ["月の図書館", "ja"],
      ["Tsuki no Toshokan", "ja-Latn"],
      ["Moon Library", "en"],
    ],
  );
  assert.equal(
    seriesAliasesMatch(
      titles.map((title) => title.title),
      "Moon Library",
    ),
    true,
  );
  assert.equal(
    seriesAliasesMatch(
      titles.map((title) => title.title),
      "Moon Library: After Story",
    ),
    false,
  );
  assert.equal(
    seriesAliasesMatch(
      titles.map((title) => title.title),
      "Library",
    ),
    false,
  );
});

test("HTML synopsis is text-only, preserves paragraphs, and matches the verified product", () => {
  const html = `<html lang="ja"><script type="application/ld+json">[{"isbn":"9784065400028","description":"<p>本の物語。</p><p>続き。</p><script>alert(1)</script>"},{"isbn":"9781975325746","description":"Unrelated recommendation"}]</script></html>`;
  // A script terminator in JSON is invalid HTML; use a separately safe fixture.
  const safe = html.replace("<script>alert(1)</script>", "");
  const metadata = htmlSeriesMetadata(
    safe,
    "Publisher",
    "https://example.com/book",
    "9784065400028",
  );
  assert.equal(metadata.synopses[0].text, "本の物語。\n続き。");
  assert.equal(metadata.synopses[0].language, "ja");
  assert.equal(
    synopsisText(
      "<p>Hello &amp; goodbye</p><script>alert(1)</script><img src=x onerror=alert(1)>",
    ),
    "Hello & goodbye",
  );
  assert.equal(synopsisText(synopsisText("<p>A</p><p>B</p>")), "A\nB");
});

test("synopsis variants from every source survive metadata merging and reject unsafe links", () => {
  const first = {
    synopses: [
      {
        text: "English synopsis",
        language: "en",
        source: "AniList",
        url: "https://anilist.co/manga/1",
      },
    ],
  };
  const second = {
    synopses: [
      {
        text: "日本語のあらすじ",
        language: "ja",
        source: "Publisher",
        url: "https://example.com/book",
      },
    ],
  };
  const result = mergeSeriesMetadata(first, first, second, {
    synopses: [
      {
        text: "Unsafe",
        language: "en",
        source: "X",
        url: "javascript:alert(1)",
      },
    ],
  });
  assert.equal(result.synopses.length, 2);
  assert.deepEqual(result, mergeSeriesMetadata(second, first));
  const metadata = scrapedMetadata({
    ...first,
    isbn: "9786163377302",
    isbnVerified: true,
    title: "Moon Library",
    price: 123,
    note: "private",
  });
  assert.equal(metadata.synopses.length, 1);
  assert.equal(Object.hasOwn(metadata, "price"), false);
  assert.equal(Object.hasOwn(metadata, "note"), false);
  assert.equal(fillScrapedMetadata(metadata, second).synopses.length, 2);
});

test("AniList retains English, native and romanized titles and a safe synopsis", () => {
  const media = parseAnimeMedia({
    id: 42,
    type: "MANGA",
    format: "MANGA",
    title: {
      english: "Moon Library",
      native: "月の図書館",
      romaji: "Tsuki no Toshokan",
    },
    description: "<b>A library</b><br>under the moon.",
  });
  assert.deepEqual(
    media.translatedTitles.map((title) => title.language),
    ["en", "ja-Latn", "ja"],
  );
  assert.equal(media.synopses[0].text, "A library\nunder the moon.");
  assert.equal(media.synopses[0].url, "https://anilist.co/manga/42");
});

test("nested product descriptions keep the romanized title and use content language, not storefront language", () => {
  const metadata = htmlSeriesMetadata(
    '<html lang="en"><div class="product-description"><div>เรื่องย่อภาษาไทย</div><p>Romaji: Tsuki no Toshokan</p></div></html>',
    "Publisher",
    "https://example.com/book",
  );
  assert.equal(metadata.synopses[0].language, "th");
  assert.match(metadata.synopses[0].text, /Romaji/);
  assert.equal(metadata.titles[0].title, "Tsuki no Toshokan");
});
