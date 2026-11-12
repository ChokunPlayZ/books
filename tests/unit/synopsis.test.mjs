import test from "node:test";
import assert from "node:assert/strict";
import {
  compactSynopsisText,
  synopsisPresentation,
} from "../../lib/domain/synopsis.ts";
import { preferredSynopses } from "../../lib/domain/metadata-source.ts";

const synopsis = {
  text: "The publisher's story.",
  language: "en",
  source: "Yen Press",
  url: "https://yenpress.com/series/moon-library",
};

test("synopsis display removes standalone dividers and blank lines, preserving wording and line boundaries", () => {
  const text =
    "\r\n ---------- \r\n\r\n เรื่อง:\r\n\r\n เรื่องย่อภาษาไทย \r\n\r\n - - - - \r\n A long-term plan — and its consequences. \r\n\r\n ————— \r\n Second paragraph. \r\n_____\r\n───\r\n";
  const expected =
    "เรื่อง:\nเรื่องย่อภาษาไทย\nA long-term plan — and its consequences.\nSecond paragraph.";
  assert.equal(compactSynopsisText(text), expected);
  assert.equal(compactSynopsisText(expected), expected);
  assert.equal(
    compactSynopsisText(
      "- A list item\n-1 degrees\n— Dialogue\nWait...\nA --- B",
    ),
    "- A list item\n-1 degrees\n— Dialogue\nWait...\nA --- B",
  );
  assert.equal(compactSynopsisText(" \n -------- \n\n"), "");
});

test("missing source credits use the selected synopsis's provenance without changing storage", () => {
  const original = { ...synopsis, text: "----------\n\nThe story.\n\n" };
  assert.deepEqual(synopsisPresentation(original), {
    text: "The story.",
    source: "Yen Press",
  });
  assert.equal(original.text, "----------\n\nThe story.\n\n");
  assert.equal(synopsisPresentation(synopsis).source, "Yen Press");
  assert.equal(
    synopsisPresentation({ ...synopsis, source: "" }).source,
    "yenpress.com",
  );
  assert.equal(
    synopsisPresentation({ ...synopsis, source: "", url: "invalid" }).source,
    "",
  );
  assert.equal(
    synopsisPresentation({ ...synopsis, text: "----------" }).source,
    "",
  );
});

test("existing English or Thai source credits are preserved without another credit", () => {
  for (const credit of [
    "Source: Yen Press",
    "source : Yen Press",
    "Sources： Yen Press",
    "(Source: Yen Press)",
    "[Source: Yen Press]",
    "ที่มา: Phoenix Next",
    "แหล่งที่มา: Phoenix Next",
    "แหล่งข้อมูล: Phoenix Next",
  ]) {
    const text = synopsis.text + "\n" + credit;
    assert.deepEqual(synopsisPresentation({ ...synopsis, text }), {
      text,
      source: "",
    });
  }
  assert.equal(
    synopsisPresentation({
      ...synopsis,
      text: "The story. (Source: Yen Press)",
    }).source,
    "",
  );
  assert.equal(
    synopsisPresentation({
      ...synopsis,
      text: "They find the source: a spring in the mountains.",
    }).source,
    "Yen Press",
  );
});

test("divider-only publisher descriptions fall back to readable sources", () => {
  const empty = { ...synopsis, text: "----------\n\n—————" };
  const fallback = {
    ...synopsis,
    text: "A catalog story.",
    source: "AniList",
    url: "https://anilist.co/manga/42",
  };
  assert.deepEqual(preferredSynopses([empty, fallback]), [fallback]);
  assert.deepEqual(preferredSynopses([empty]), []);
});
