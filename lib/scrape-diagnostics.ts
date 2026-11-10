export type ScrapeDiagnostic = {
  kind:
    | "http"
    | "timeout"
    | "dns"
    | "connection"
    | "tls"
    | "response"
    | "parser"
    | "cooldown"
    | "not_found"
    | "scraper";
  message: string;
  sourceId?: string;
  operation?: string;
  url?: string;
  status?: number;
};

export function formatScrapeDiagnostic(diagnostic: ScrapeDiagnostic) {
  return [
    [diagnostic.sourceId, diagnostic.operation].filter(Boolean).join(" · "),
    diagnostic.status &&
    !diagnostic.message.includes(`HTTP ${diagnostic.status}`)
      ? `HTTP ${diagnostic.status}`
      : "",
    diagnostic.message,
    diagnostic.url,
  ]
    .filter(Boolean)
    .join(" — ");
}
