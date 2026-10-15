import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { parseImport } from "../../lib/server/importer.ts";
import { releaseItem } from "../../lib/domain.ts";

// Exercise the same SQLite records and catalog services as the application.
export function createTestLibrary(books = []) {
  const store = openStore(":memory:");
  if (books.length) {
    const plan = parseImport(Buffer.from(JSON.stringify(books)), "books.json");
    store.importData(plan, plan.fingerprint);
  }
  let responses = [];
  const catalogs = createCatalogService(store, async (url) => {
    const response = responses.find((entry) => url.includes(entry.match));
    return new Response(
      response?.text ?? JSON.stringify(response?.body ?? {}),
      {
        status: response?.status ?? 200,
        headers: response?.headers,
      },
    );
  });
  return {
    api: { ...store.api, ...catalogs, releaseItem },
    setResponses(entries) {
      responses = entries;
    },
    close: () => store.close(),
  };
}
