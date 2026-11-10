import type { ScrapeDiagnostic } from "./scrape-diagnostics.ts";

export type ScraperDebugSource = {
  id: string;
  name: string;
  isbn: boolean;
  title: boolean;
};
export type ScraperDebugRequest = {
  isbn?: string;
  query?: string;
  providerId: string;
};
export type ScraperDebugResponse = {
  url: string;
  method: string;
  startedAt: string;
  durationMs: number;
  status: number | null;
  contentType: string;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  truncated?: boolean;
  error: string;
};
export type ScraperDebugResult = {
  isbn: string;
  query: string;
  mode: "isbn" | "title";
  outcome: "found" | "not_found" | "failed";
  message: string;
  diagnostics: ScrapeDiagnostic[];
  providerId: string;
  startedAt: string;
  durationMs: number;
  responses: ScraperDebugResponse[];
  snapshots: { source: string; value: unknown }[];
  cooldowns: string[];
  result: unknown;
  error: string;
  stack: string;
};
