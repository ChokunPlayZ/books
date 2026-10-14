import { openStore } from "./store.mjs";
import { createApplicationApi } from "./api.mjs";
import { createCoverService } from "./covers.mjs";

// Next development reloads modules; keep one connection per process.
export function getApp() {
  if (globalThis.__bookCollectionApp?.storageVersion !== 3) {
    const store = openStore();
    const covers = createCoverService(store);
    globalThis.__bookCollectionApp = {
      storageVersion: 3,
      store,
      covers,
      api: createApplicationApi(store, covers),
    };
  }
  return globalThis.__bookCollectionApp;
}
