import { openStore } from "./store.mjs";
import { createApplicationApi } from "./api.mjs";
import { createCoverService } from "./covers.mjs";

// Next development reloads modules; keep one connection per process.
export function getApp() {
  if (!globalThis.__bookCollectionApp) {
    const store = openStore();
    const covers = createCoverService(store);
    globalThis.__bookCollectionApp = {
      store,
      covers,
      api: createApplicationApi(store, covers),
    };
  }
  return globalThis.__bookCollectionApp;
}
