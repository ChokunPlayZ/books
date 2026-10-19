export function names(v) {
  return (Array.isArray(v) ? v : v ? [v] : [])
    .map(function (x) {
      return typeof x === "string" ? x : x.name || "";
    })
    .filter(Boolean)
    .join(", ");
}

export function structuredBooks(html) {
  const out = [],
    re =
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  function visit(v) {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(visit);
    if (v.isbn || v.gtin || v.gtin13 || v.sku) out.push(v);
    if (v["@graph"]) visit(v["@graph"]);
  }
  let match;
  while ((match = re.exec(html))) {
    try {
      visit(JSON.parse(match[1]));
    } catch (e) {}
  }
  return out;
}

export function meta(html, property) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const tag = tags.find(function (t) {
    return attr(t, "property") === property;
  });
  return tag ? attr(tag, "content") : "";
}

export function attr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    "(?:^|\\s)" + escaped + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
    "i",
  ).exec(tag);
  return match
    ? decodeHtml(
        match[1] === undefined
          ? match[2] === undefined
            ? match[3]
            : match[2]
          : match[1],
      )
    : "";
}

export function decodeHtml(s) {
  return String(s)
    .replace(/&#(x[\da-f]+|\d+);/gi, function (_, n) {
      const code =
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function textHtml(s) {
  return decodeHtml(String(s).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
