import type { Book, Release } from "../../types.ts";
import type { createScrapeCache } from "../scrape-cache.ts";

export type ScraperCache = {
  get(key: string): string | null;
  put(key: string, value: string, seconds: number): void;
};

export type ScraperContext = {
  cache: ScraperCache;
  scrapeCache: ReturnType<typeof createScrapeCache>;
  requestRemote(
    url: string,
    options?: RequestInit,
  ): Promise<{
    status: number;
    body: string;
    headers: Record<string, string | string[]>;
  }>;
  fetchText(
    url: string,
    refresh?: boolean,
    maxAge?: number,
    options?: RequestInit,
  ): Promise<string>;
  // JSON is validated by each source before it is used.
  fetchJson<T = unknown>(
    url: string,
    refresh?: boolean,
    maxAge?: number,
  ): Promise<T>;
};

export type CatalogResult = {
  items: Release[];
  total: number | null;
  pages: number;
  complete: boolean;
  title?: string;
  search?: boolean;
};

export type Category = { title: string; url: string; type?: string };
export type PublisherTitle = {
  id: string;
  publisherId: string;
  publisher: string;
  series: string;
  title: string;
  type: string;
  url: string;
  categories: { url: string; type?: string }[];
  volume: number | "";
  isbn: string;
  coverUrl?: string;
  directory: boolean;
};

export type IsbnSearchResult = {
  publisherId: string;
  isbn: string;
  url: string;
  items: Release[];
  warnings: string[];
};

export type BookDetails = {
  isbn?: string;
  title: string;
  publisher?: string;
  authors?: string;
  source?: string;
  url?: string;
  coverUrl?: string;
  series?: string;
  volume?: number | "";
  type?: string;
  releaseDate?: string;
  regularPrice?: number | "";
  price?: number | "";
  currency?: string;
  availability?: string;
};

export type CoverOption = {
  coverUrl: string;
  url: string;
  title: string;
  source?: string;
  sourceUrl?: string;
};

// Implement only the capabilities a source actually supports.
export type Scraper = {
  releases?(refresh?: boolean): Promise<Release[]>;
  catalog?(url: string, refresh?: boolean): Promise<CatalogResult>;
  directory?(
    url: string,
    refresh?: boolean,
  ): Promise<{ titles: PublisherTitle[]; title: string }>;
  directoryAsCatalog?(url: string): boolean;
  seriesDirectory?: {
    url: string;
    manual?: boolean;
    fromPublisherDirectory?: boolean;
    load?(refresh?: boolean): Promise<Category[]>;
  };
  searchSeriesUrl?(series: string): string;
  searchIsbn?(isbn: string, refresh?: boolean): Promise<IsbnSearchResult>;
  lookupIsbn?(isbn: string, refresh?: boolean): Promise<BookDetails | null>;
  coverOptions?(book: Book, refresh?: boolean): Promise<CoverOption[]>;
  gallery?(
    item: Partial<Release> & { url: string; title: string },
    book: Book,
    refresh?: boolean,
  ): Promise<{ coverUrl: string; url?: string; title?: string }[]>;
  normalizeDirectory?(titles: PublisherTitle[]): PublisherTitle[];
  preserveParsedSeries?: boolean;
  preserveCompleteSeries?: boolean;
  coverFromSeries?: boolean;
};

export type ScraperDefinition = {
  id: string;
  hosts: readonly string[];
  priceSource?: {
    name: string;
    currency: string;
    searchUrl(isbn: string): string;
  };
  redirectIdentity?(url: URL): string;
  // Canonical ISBN-13 prefixes served by this source; omit for multilingual sources.
  isbnPrefixes?: readonly string[];
  // Lower numbers are preferred, independently of request completion order.
  isbnPriority?: number;
  isbnWarning?: string;
  coverPriority?: number;
  coverWarning?: string;
  create(context: ScraperContext): Scraper;
};
