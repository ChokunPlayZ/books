export const CRAWL_MODES = {
  all: "All discoverable series",
  new: "New books in all series",
  "new-series": "New series only",
  latest: "Latest releases only",
} as const;
export type CrawlMode = keyof typeof CRAWL_MODES;
export type CrawlSource = { id: string; name: string; full: boolean };
export type PublisherCrawl = {
  id: string;
  publisherId: string;
  mode: CrawlMode;
  status: "running" | "paused" | "cancelled" | "completed" | "failed";
  jobId: string;
  processed: number;
  discovered: number;
  remaining: number | null;
  currentLabel: string;
  warnings: string[];
  error: string;
};
export type CrawlOverview = {
  sources: CrawlSource[];
  crawls: PublisherCrawl[];
};
