import { openStore } from "./store.mjs";
import { createCatalogService } from "./catalogs.mjs";
import { createCoverCache } from "./covers.mjs";

// Next development reloads modules; keep one connection per process.
export function getApp() {
  if (!globalThis.__bookCollectionApp) {
    const store = openStore();
    globalThis.__bookCollectionApp = {
      store,
      api: { ...store.api, ...createCatalogService(store) },
    };
  }
  globalThis.__bookCollectionApp.covers ||= createCoverCache();
  return globalThis.__bookCollectionApp;
}
