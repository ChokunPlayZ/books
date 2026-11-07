import { openStore, type Store } from "./store.ts";
import { createApplicationApi, applicationQueue } from "./api.ts";
import { createCoverService } from "./covers.ts";

type BookApplication = {
  storageVersion: number;
  apiVersion: number;
  store: Store;
  covers: ReturnType<typeof createCoverService>;
  api: ReturnType<typeof createApplicationApi>;
};

const applicationGlobal = globalThis as typeof globalThis & {
  __bookCollectionApp?: BookApplication;
  __bookCollectionOpening?: Promise<BookApplication>;
};
const API_VERSION = 8;
// Reopen the store when its in-memory methods change during development.
const STORE_VERSION = 11;

// Next development reloads modules; share one pool and one initialization promise.
export async function getApp(): Promise<BookApplication> {
  if (applicationGlobal.__bookCollectionApp?.storageVersion !== STORE_VERSION) {
    applicationGlobal.__bookCollectionOpening ??= (async () => {
      await applicationGlobal.__bookCollectionApp?.store.close();
      const store = await openStore();
      const covers = createCoverService(store);
      return (applicationGlobal.__bookCollectionApp = {
        storageVersion: STORE_VERSION,
        apiVersion: API_VERSION,
        store,
        covers,
        api: createApplicationApi(store, covers),
      });
    })().finally(() => {
      applicationGlobal.__bookCollectionOpening = undefined;
    });
    await applicationGlobal.__bookCollectionOpening;
  }
  // Refresh service methods after a development reload without reopening the pool.
  if (applicationGlobal.__bookCollectionApp.apiVersion !== API_VERSION) {
    const app = applicationGlobal.__bookCollectionApp;
    app.api = createApplicationApi(app.store, app.covers);
    app.apiVersion = API_VERSION;
  }
  const app = applicationGlobal.__bookCollectionApp;
  applicationQueue(app.store)?.start();
  return app;
}
