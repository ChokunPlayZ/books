import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../lib/server/store.ts";
import { createCatalogService } from "../../lib/server/catalogs.ts";
import { createAccount } from "../../lib/server/auth.ts";

const isbn = "9786166247275";
test("confirmed ISBN/source matches survive time, restart, other users, prices and cover lookups until admin refresh", async (t) => {
  const path = join(
    mkdtempSync(join(tmpdir(), "books-permanent-")),
    "books.sqlite",
  );
  let store = openStore(path);
  t.after(() => store.close());
  let calls = 0;
  const definition = {
    id: "shop",
    hosts: ["shop.example"],
    priceSource: {
      name: "Shop",
      currency: "THB",
      searchUrl: (code) => "https://shop.example/search?q=" + code,
    },
    create: () => ({
      lookupIsbn: async () => {
        calls++;
        return {
          isbn,
          title: "Public book",
          type: "Manga (TH)",
          price: calls === 1 ? 150 : 160,
          msrp: 175,
          currency: "THB",
          url: "https://shop.example/book",
          availability: "In stock",
        };
      },
    }),
  };
  let catalogs = createCatalogService(store, () => assert.fail("No network"), [
    definition,
  ]);
  const initial = await catalogs.lookupIsbn(isbn);
  assert.equal(initial.details.msrp, 175);
  assert.equal(
    (await catalogs.findLowestPrices({ isbn })).offers[0].price,
    150,
  );
  assert.equal(calls, 1);
  store.db.prepare("UPDATE cache SET expires_at=1 WHERE expires_at<>0").run();
  store.close();
  store = openStore(path);
  const user = createAccount(store, "reader", "reader@gmail.com");
  catalogs = createCatalogService(store, () => assert.fail("No network"), [
    definition,
  ]);
  await store.forUser(user, async () => {
    assert.equal(
      (await catalogs.lookupIsbn(isbn)).details.title,
      "Public book",
    );
    assert.equal(
      (await catalogs.findLowestPrices({ isbn })).offers[0].price,
      150,
    );
    await assert.rejects(catalogs.lookupIsbn({ isbn, refresh: true }), {
      status: 403,
    });
  });
  assert.equal(calls, 1);
  assert.equal(
    (await catalogs.findLowestPrices({ isbn, refresh: true })).offers[0].price,
    160,
  );
  assert.equal(calls, 2);
  assert.equal(
    (await catalogs.lookupIsbn(isbn)).details.price,
    160,
    "An admin price refresh also updates the aggregate ISBN snapshot",
  );
});

test("misses expire and retry, and concurrent readers share a single confirmed lookup", async (t) => {
  const store = openStore(":memory:");
  t.after(() => store.close());
  let calls = 0;
  let found = false;
  const definition = {
    id: "shop",
    hosts: ["shop.example"],
    create: () => ({
      lookupIsbn: async () => {
        calls++;
        await Promise.resolve();
        return found
          ? { isbn, title: "Found later", url: "https://shop.example/book" }
          : null;
      },
    }),
  };
  const catalogs = createCatalogService(store, fetch, [definition]);
  assert.equal((await catalogs.lookupIsbn(isbn)).found, false);
  assert.equal((await catalogs.lookupIsbn(isbn)).found, false);
  assert.equal(calls, 1);
  store.db.exec("UPDATE cache SET expires_at=1 WHERE expires_at<>0");
  found = true;
  const results = await Promise.all([
    catalogs.lookupIsbn(isbn),
    createCatalogService(store, fetch, [definition]).lookupIsbn(isbn),
  ]);
  assert.ok(results.every((result) => result.found));
  assert.equal(calls, 2);
});
