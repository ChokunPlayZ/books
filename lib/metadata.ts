export const CACHE_GROUPS = {
  isbn: "ISBN metadata",
  catalogs: "Publisher catalogs",
  responses: "Source pages & APIs",
  covers: "Cover lookups",
  anime: "Anime discovery",
  other: "Other lookups",
  cooldowns: "Retry cooldowns",
} as const;

export type CacheGroup = keyof typeof CACHE_GROUPS;
export type MetadataQuery = {
  group?: CacheGroup | "all";
  search?: string;
  expiredOnly?: boolean;
  page?: number;
};
export type CacheEntry = {
  key: string;
  group: CacheGroup;
  label: string;
  bytes: number;
  expiresAt: number;
  checkedAt: string;
  expired: boolean;
};
export type CrawlTarget = {
  id: string;
  kind: "isbn" | "series" | "releases" | "catalog" | "directory";
  label: string;
  detail: string;
};
export type MetadataOverview = {
  summary: { count: number; bytes: number; expired: number; cooldowns: number };
  groups: { id: CacheGroup; count: number }[];
  entries: CacheEntry[];
  total: number;
  page: number;
  pages: number;
  targets: CrawlTarget[];
  coverage: {
    books: number;
    withIsbn: number;
    missingCover: number;
    missingLink: number;
    missingPages: number;
  };
};
export type CrawlResult = {
  id: string;
  status: "updated" | "warning" | "failed";
  message: string;
  filled: number;
};
