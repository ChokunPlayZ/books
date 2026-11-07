export const SYSTEM_RESOURCES = {
  users: "Accounts",
  books: "Books (including removed)",
  saved_releases: "Saved releases",
  series_catalogs: "Linked series catalogs",
  covers: "Stored covers",
  cover_sources: "Public cover sources",
  user_cover_sources: "Private cover sources",
  cover_access: "Cover permissions",
  options: "Library dropdown options",
  imports: "Import receipts",
  receipts: "Mutation receipts",
} as const;
export type SystemResource = keyof typeof SYSTEM_RESOURCES;
export type SystemOverview = {
  counts: Record<SystemResource | "cache" | "sessions", number>;
};
export type SystemRecords = {
  resource: SystemResource;
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pages: number;
};
