export type AdminUser = {
  id: number;
  username: string;
  email: string;
  role: "admin" | "user";
  disabled: boolean;
  linked: boolean;
  createdAt: string;
  locale: string;
  theme: string;
  books: number;
  removed: number;
  savedReleases: number;
  catalogs: number;
  sessions: number;
};
export type AdminUsers = {
  users: AdminUser[];
  total: number;
  page: number;
  pages: number;
};
export type AdminLibrary = {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pages: number;
};
