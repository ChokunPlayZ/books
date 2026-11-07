const MEEMAI_ORIGIN = "https://meemai.ckl.moe";

export const OUTBOUND_LINK_ATTRIBUTES = {
  rel: "noopener",
  referrerPolicy: "strict-origin-when-cross-origin",
} as const;

// Apply only when rendering navigation links, after any source URL validation.
// Stored metadata and server-side requests must keep their canonical URLs.
export function outboundUrl(raw: string): string {
  try {
    const url = new URL(raw, MEEMAI_ORIGIN);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin === MEEMAI_ORIGIN
    )
      return raw;
    url.searchParams.set("ref", "meemai.ckl.moe");
    return url.href;
  } catch {
    return raw;
  }
}
