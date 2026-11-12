import type { Synopsis } from "./series-info.ts";

// Clean the reading view, not the saved publisher text or its provenance.
export function compactSynopsisText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(?:[-‐‑‒–—―─━_]\s*){3,}$/u.test(line))
    .join("\n");
}

export function synopsisPresentation(synopsis: Synopsis) {
  const text = compactSynopsisText(synopsis.text);
  const attributed =
    /(?:^|\n|[([])\s*(?:sources?|ที่มา|แหล่งที่มา|แหล่งข้อมูล|เครดิต)\s*[:：]\s*\S/iu.test(
      text,
    );
  let source = synopsis.source.trim();
  if (!source) {
    try {
      source = new URL(synopsis.url).hostname.replace(/^www\./, "");
    } catch {}
  }
  return { text, source: text && !attributed ? source : "" };
}
