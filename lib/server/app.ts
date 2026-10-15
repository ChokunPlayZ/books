import { openStore } from "./store.ts";
import { createApplicationApi } from "./api.ts";
import { createCoverService } from "./covers.ts";

type BookApplication = {
  storageVersion: number;
  store: ReturnType<typeof openStore>;
  covers: ReturnType<typeof createCoverService>;
  api: ReturnType<typeof createApplicationApi>;
};

const applicationGlobal = globalThis as typeof globalThis & {
  __bookCollectionApp?: BookApplication;
};

// Next development reloads modules; keep one connection per process.
export function getApp(): BookApplication {
  if (applicationGlobal.__bookCollectionApp?.storageVersion !== 3) {
    const store = openStore();
    const covers = createCoverService(store);
    applicationGlobal.__bookCollectionApp = {
      storageVersion: 3,
      store,
      covers,
      api: createApplicationApi(store, covers),
    };
  }
  return applicationGlobal.__bookCollectionApp;
}
