import { openStore } from "./store.ts";
import { createApplicationApi } from "./api.ts";
import { createCoverService } from "./covers.ts";

type BookApplication = {
  storageVersion: number;
  apiVersion: number;
  store: ReturnType<typeof openStore>;
  covers: ReturnType<typeof createCoverService>;
  api: ReturnType<typeof createApplicationApi>;
};

const applicationGlobal = globalThis as typeof globalThis & {
  __bookCollectionApp?: BookApplication;
};
const API_VERSION = 1;

// Next development reloads modules; keep one connection per process.
export function getApp(): BookApplication {
  if (applicationGlobal.__bookCollectionApp?.storageVersion !== 3) {
    const store = openStore();
    const covers = createCoverService(store);
    applicationGlobal.__bookCollectionApp = {
      storageVersion: 3,
      apiVersion: API_VERSION,
      store,
      covers,
      api: createApplicationApi(store, covers),
    };
  }
  // Refresh service methods after a development reload without reopening SQLite.
  if (applicationGlobal.__bookCollectionApp.apiVersion !== API_VERSION) {
    const app = applicationGlobal.__bookCollectionApp;
    app.api = createApplicationApi(app.store, app.covers);
    app.apiVersion = API_VERSION;
  }
  return applicationGlobal.__bookCollectionApp;
}
