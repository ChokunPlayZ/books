import { AsyncLocalStorage } from "node:async_hooks";
import { STATUS_CODES } from "node:http";
import type { ScrapeDiagnostic } from "../scrape-diagnostics.ts";
import { formatScrapeDiagnostic } from "../scrape-diagnostics.ts";
export { formatScrapeDiagnostic } from "../scrape-diagnostics.ts";

type Context = {
  diagnostics: ScrapeDiagnostic[];
  sourceId?: string;
  operation?: string;
  onDiagnostic?: (diagnostic: ScrapeDiagnostic) => void;
};
const context = new AsyncLocalStorage<Context>();

export class ScrapeFailure extends Error {
  diagnostic: ScrapeDiagnostic;
  status?: number;
  constructor(diagnostic: ScrapeDiagnostic, cause?: unknown) {
    super(diagnostic.message, { cause });
    this.name = "ScrapeFailure";
    this.diagnostic = diagnostic;
    // Preserve body-limit/timeout errors used by the bounded HTTP reader.
    if (cause && typeof (cause as { status?: unknown }).status === "number")
      this.status = (cause as { status: number }).status;
  }
}

export function withScrapeDiagnostics<T>(
  diagnostics: ScrapeDiagnostic[],
  action: () => T,
  onDiagnostic?: (diagnostic: ScrapeDiagnostic) => void,
): T {
  return context.run({ diagnostics, onDiagnostic }, action);
}

export function withScrapeSource<T>(
  sourceId: string,
  operation: string,
  action: () => T,
): T {
  const current = context.getStore();
  return current
    ? context.run({ ...current, sourceId, operation }, action)
    : action();
}

export function recordScrapeDiagnostic(diagnostic: ScrapeDiagnostic) {
  const current = context.getStore();
  if (!current) return;
  const value = {
    sourceId: current.sourceId,
    operation: current.operation,
    ...diagnostic,
  };
  // Never persist request headers, cookies or response bodies in queue history.
  if (
    current.diagnostics.length < 200 &&
    !current.diagnostics.some(
      (previous) => JSON.stringify(previous) === JSON.stringify(value),
    )
  ) {
    current.diagnostics.push(value);
    current.onDiagnostic?.(value);
  }
}

export function errorMessage(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  for (let current = error; current && !seen.has(current);) {
    seen.add(current);
    const value = current as Error & { code?: string };
    const message =
      current instanceof ScrapeFailure
        ? formatScrapeDiagnostic(current.diagnostic)
        : typeof value.message === "string"
          ? value.message
          : String(current);
    messages.push(
      value.code && !message.includes(value.code)
        ? `${message} (${value.code})`
        : message,
    );
    current = value.cause;
  }
  return messages.join(": ").slice(0, 2000) || "Unknown scraping error.";
}

export function recordScrapeError(error: unknown) {
  recordScrapeDiagnostic(
    error instanceof ScrapeFailure
      ? error.diagnostic
      : {
          kind: error instanceof SyntaxError ? "parser" : "scraper",
          message: errorMessage(error),
        },
  );
}

export function httpFailure(url: string, status: number) {
  return new ScrapeFailure({
    kind: "http",
    status,
    url,
    message: `Website returned HTTP ${status}${STATUS_CODES[status] ? ` (${STATUS_CODES[status]})` : ""}.`,
  });
}

export function requestFailure(
  error: unknown,
  url: string,
  status: number | null,
) {
  const detail = errorMessage(error);
  const kind = /timeout|timed out|ETIMEDOUT|ABORT_ERR/i.test(detail)
    ? "timeout"
    : /ENOTFOUND|EAI_AGAIN|ENODATA/.test(detail)
      ? "dns"
      : /CERT_|TLS|SSL|certificate/i.test(detail)
        ? "tls"
        : status !== null
          ? "response"
          : "connection";
  const label = {
    timeout: "Website request timed out",
    dns: "Website hostname could not be resolved",
    tls: "Website TLS/certificate error",
    response: "Website response could not be read",
    connection: "Could not connect to website",
  }[kind];
  return new ScrapeFailure(
    {
      kind,
      url,
      ...(status !== null ? { status } : {}),
      message: `${label}${status !== null ? ` (HTTP ${status})` : ""}: ${detail}`,
    },
    error,
  );
}
