export type ScraperDebugSource = { id: string; name: string };
export type ScraperDebugRequest = { isbn: string; providerId: string };
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
