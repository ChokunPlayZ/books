import { createHash } from "node:crypto";

export function stableJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map(function (k) {
        return JSON.stringify(k) + ":" + stableJson(v[k]);
      })
      .join(",") +
    "}"
  );
}

export function digest(text) {
  return createHash("sha256").update(text).digest("base64url");
}
