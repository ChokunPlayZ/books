import { decodeHtml } from "./domain/html.ts";
import { safeCoverUrl } from "./domain/urls.ts";

export function formatBytes(bytes: number, locale = "en-GB") {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let size = bytes;
  let unit = 0;
  // Promote rounded values too, rather than displaying 1,024 KiB.
  while (unit < units.length - 1 && Math.round(size * 10) / 10 >= 1024) {
    size /= 1024;
    unit++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`;
}

export function unpackRecord(value: unknown): unknown {
  if (typeof value !== "string" || !/^[\s]*[\[{]/.test(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function recordObject(value: unknown): Record<string, unknown> | null {
  const parsed = unpackRecord(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

export function recordFields(row: Record<string, unknown>) {
  const data = recordObject(row.data);
  if (!data) return row;
  const { data: _stored, ...columns } = row;
  const overlaps = Object.fromEntries(
    Object.entries(data).filter(
      ([key, value]) => Object.hasOwn(columns, key) && columns[key] !== value,
    ),
  );
  return {
    ...data,
    ...columns,
    ...(Object.keys(overlaps).length ? { stored_data: overlaps } : {}),
  };
}

export function fieldLabel(key: string, resource = "") {
  if (key === "source" && resource === "books") return "Bought from";
  const labels: Record<string, string> = {
    id: "Record ID",
    user_id: "Account ID",
    username: "Account",
    isbn: "ISBN",
    canonical_isbn: "Canonical ISBN",
    cover_id: "Cover ID",
    coverId: "Cover ID",
    cover_url: "Cover image",
    coverUrl: "Cover image",
    publisher_url: "Publisher page",
    publisherUrl: "Publisher page",
    purchased_on: "Purchased on",
    msrp: "List price",
    msrp_currency: "Currency",
    msrpCurrency: "Currency",
    bytes: "File size",
    content_type: "File type",
    value: "Content",
    note: "Notes",
    page_count: "Page count",
  };
  if (Object.hasOwn(labels, key)) return labels[key];
  const words = key
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function recordTitle(row: Record<string, unknown>) {
  const fields = recordFields(row);
  for (const key of [
    "title",
    "series",
    "username",
    "name",
    "label",
    "field",
    "action",
  ])
    if (typeof fields[key] === "string" && fields[key])
      return fields[key] as string;
  return "";
}

export function safeRecordLink(value: string) {
  try {
    const url = new URL(value.replace(/^(?:text|json):(?=https?:)/, ""));
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function recordImage(value: unknown, key = "") {
  if (typeof value !== "string") return "";
  if (/^(?:cover_?id)$/i.test(key) && /^[a-f\d]{64}$/.test(value))
    return `/api/covers/${value}?inspection=1`;
  const url = safeCoverUrl(value);
  return url &&
    (/cover|image|thumbnail|picture/i.test(key) ||
      /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(url))
    ? url
    : "";
}

// Scraped markup is converted to text, never inserted into the document. This
// also avoids loading embedded frames, scripts, tracking pixels or styles.
export function readableText(value: string) {
  if (!/<\/?[a-z][^>]*>/i.test(value)) return value;
  return decodeHtml(
    value
      .replace(
        /<(script|style|template|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
        "",
      )
      .replace(/<!--[^]*?(?:-->|$)/g, "")
      .replace(
        /<\/?(?:p|div|h[1-6]|li|tr|section|article|br|hr)\b[^>]*>/gi,
        "\n",
      )
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function recordDate(value: unknown, key: string) {
  if (!/(?:_at|At|_on|On)$/.test(key) || !value) return "";
  if (typeof value !== "number" && typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
