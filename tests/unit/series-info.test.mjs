import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  descriptionTitles,
  htmlSeriesMetadata,
  mergeSeriesMetadata,
  seriesAliasesMatch,
  synopsisText,
} from "../../lib/domain/series-info.ts";
import { parseAnimeMedia } from "../../lib/domain/anime.ts";
import { preferredSynopses } from "../../lib/domain/metadata-source.ts";
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

test("synopses choose publishers before bookstores and catalogs, independent of text or arrival order", () => {
  const synopsis = (text, url, language = "en") => ({
    text,
    url,
    language,
    source: "Stored citation",
  });
  const catalog = synopsis("A catalog summary", "https://anilist.co/manga/42");
  const store = synopsis(
    "A store summary",
    "https://www.naiin.com/product/detail/42",
  );
  const product = synopsis(
    "Publisher product summary",
    "https://yenpress.com/titles/moon",
  );
  const publisher = synopsis(
    "Publisher series summary",
    "https://yenpress.com/series/moon",
  );
  const thai = synopsis(
    "เรื่องย่อ",
    "https://www.phoenixnext.com/moon.html",
    "th",
  );
  for (const records of [
    [catalog, store, product, publisher, thai],
    [thai, publisher, product, store, catalog],
  ]) {
    const result = preferredSynopses(records);
    assert.equal(
      result.find((item) => item.language === "en"),
      publisher,
    );
    assert.equal(
      result.find((item) => item.language === "th"),
      thai,
    );
    assert.equal(
      records.length,
      5,
      "All provenance remains in the stored input",
    );
  }
  assert.deepEqual(preferredSynopses([catalog, store]), [store]);
  assert.deepEqual(preferredSynopses([catalog]), [catalog]);
  assert.deepEqual(preferredSynopses([{ ...publisher, text: " " }, store]), [
    store,
  ]);
});

test("HTML synopsis is text-only, preserves paragraphs, and matches the verified product", () => {
  const html = `<html lang="ja"><script type="application/ld+json">[{"isbn":"9784063951370","description":"<p>本の物語。</p><p>続き。</p><script>alert(1)</script>"},{"isbn":"9781975325746","description":"Unrelated recommendation"}]</script></html>`;
  // A script terminator in JSON is invalid HTML; use a separately safe fixture.
  const safe = html.replace("<script>alert(1)</script>", "");
  const metadata = htmlSeriesMetadata(
    safe,
    "Publisher",
    "https://example.com/book",
    "9784063951370",
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

test("current publisher markup supplies the full synopsis rather than a title or SEO excerpt", () => {
  for (const [fixture, source, url, language, ending] of [
    [
      "phoenix-synopsis.html",
      "Phoenix Next",
      "https://www.phoenixnext.com/ln0838-01.html",
      "th",
      "เพื่อนำมาปั้นทฤษฎีและเรื่องรา",
    ],
    [
      "yenpress-synopsis.html",
      "Yen Press",
      "https://yenpress.com/titles/9781975319434-solo-leveling-vol-1-comic",
      "en",
      "find them a way out?",
    ],
    [
      "animag-synopsis.html",
      "Animag",
      "https://www.animagshop.com/product/1169",
      "th",
      "เรื่องราวความสำเร็จที่เต็มไปด้วยความผิดแผนนัดที่ 2 !!",
    ],
  ]) {
    const html = readFileSync(
      new URL("../fixtures/publishers/" + fixture, import.meta.url),
      "utf8",
    );
    const { synopses } = htmlSeriesMetadata(html, source, url);
    assert.equal(synopses.length, 1, fixture);
    assert.equal(synopses[0].language, language);
    assert.equal(synopses[0].source, source);
    assert.equal(synopses[0].url, url);
    assert.ok(synopses[0].text.endsWith(ending), synopses[0].text);
    assert.doesNotMatch(
      synopses[0].text,
      /รีวิวสินค้า|ชำระเงิน|เงื่อนไขอื่นๆ|ข้อตกลง|จัดพิมพ์|book-price|<[^>]+>/,
    );
  }
});

test("image-only descriptions and title-only metadata are not presented as synopses", () => {
  const html = `<meta name="title" content="Moon Library"><meta name="description" content="Moon Library"><meta property="og:description" content=""><div id="detail" class="tabPanel mceContentBody"><h2>รายละเอียดสินค้า</h2><img src="cover.jpg"></div><div id="howto" class="tabPanel">Payment instructions</div>`;
  assert.deepEqual(
    htmlSeriesMetadata(html, "Publisher", "https://example.com/book").synopses,
    [],
  );
  assert.equal(
    htmlSeriesMetadata(
      html + '<div itemprop="description"><p>The actual story.</p></div>',
      "Publisher",
      "https://example.com/book",
    ).synopses[0].text,
    "The actual story.",
  );
});

test("ISBN-10 and hyphenated structured identifiers retain verified source descriptions", () => {
  for (const isbn of ["0385496494", "978-0-385-49649-0"]) {
    const html = `<script type="application/ld+json">${JSON.stringify({ isbn, description: "The book synopsis." })}</script>`;
    assert.equal(
      htmlSeriesMetadata(
        html,
        "Publisher",
        "https://example.com/book",
        "9780385496490",
      ).synopses[0].text,
      "The book synopsis.",
    );
  }
});

test("pulling a full description replaces the same source's older excerpt without dropping other sources", () => {
  const synopsis = {
    text: "A short excerpt…",
    language: "en",
    source: "Publisher",
    url: "https://example.com/book",
  };
  const other = {
    ...synopsis,
    source: "AniList",
    url: "https://anilist.co/manga/42",
  };
  const full = {
    ...synopsis,
    text: "The full source-provided description.\nWith another paragraph.",
  };
  const merged = mergeSeriesMetadata(
    { synopses: [synopsis, other] },
    { synopses: [full] },
  );
  assert.equal(merged.synopses.length, 2);
  assert.deepEqual(
    merged.synopses.find((item) => item.source === "Publisher"),
    full,
  );
  assert.ok(merged.synopses.some((item) => item.source === "AniList"));
});
