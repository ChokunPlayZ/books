import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openTestStore } from "../helpers/database.mjs";
import { createAccount } from "../../lib/server/auth.ts";
import { createApplicationApi } from "../../lib/server/api.ts";

test("universal search isolates private shelves and series caches while sharing only public title discoveries", async (t) => {
  const store = await openTestStore();
  t.after(() => store.close());
  const alice = await createAccount(store, "alice", "alice@gmail.com");
  const bob = await createAccount(store, "bob", "bob@gmail.com");
  let requests = 0;
  const api = createApplicationApi(
    store,
    {
      ensure: () =>
        assert.fail("Search must not download covers or mutate the shelf"),
    },
    async (url) => {
      requests++;
      assert.equal(
        url,
        "https://www.phoenixnext.com/catalogsearch/result/?q=Moon",
      );
      return new Response(
        '<span class="toolbar-number">1</span><a class="product-item-link" href="https://www.phoenixnext.com/moon-1.html">Moon เล่ม 1</a>',
      );
    },
  );
  await store.forUser(alice, async () => {
    await store.api.saveBook({
      requestId: randomUUID(),
      book: {
        isbn: "",
        series: "Alice Moon shelf",
        type: "Manga",
        publisher: "Phoenix Next",
        status: "Unread",
        volume: 1,
        source: "Private shop",
        price: "",
        date: "",
        note: "Private note",
      },
    });
    await store.cache.put(
      "series:v1:private",
      JSON.stringify({
        publisherId: "phoenix",
        items: [
          {
            title: "Alice Moon alias",
            url: "https://www.phoenixnext.com/alias.html",
          },
        ],
      }),
      3600,
    );
  });
  await store.cache.put(
    "publisher-catalog:v1:shared",
    JSON.stringify({
      publisherId: "phoenix",
      items: [
        {
          title: "Shared Moon",
          url: "https://www.phoenixnext.com/shared.html",
        },
      ],
    }),
    3600,
  );
  await store.cache.put(
    "publisher-catalog:v1:expired",
    JSON.stringify({ items: [{ title: "Expired Moon" }] }),
    -1,
  );
  await store.cache.put(
    "scrape:v1:raw",
    JSON.stringify({ items: [{ title: "Secret Moon raw response" }] }),
    3600,
  );

  await store.forUser(alice, async () => {
    const known = await api.searchKnownEntities({ query: "Moon" });
    assert.equal(known.results.length, 3);
    assert.ok(
      known.results.some(
        (item) => item.title === "Alice Moon shelf" && item.owned,
      ),
    );
    assert.ok(known.results.some((item) => item.title === "Alice Moon alias"));
  });
  await store.forUser(bob, async () => {
    const known = await api.searchKnownEntities({ query: "Moon" });
    assert.deepEqual(
      known.results.map((item) => item.title),
      ["Shared Moon"],
    );
    assert.equal(requests, 0);
    const online = await api.searchExternalTitles({
      query: "Moon",
      sourceId: "phoenix",
    });
    assert.equal(online.results.length, 1);
    assert.equal(online.results[0].owned, false);
    assert.equal((await store.api.getCollection()).books.length, 0);
  });
  await store.forUser(alice, async () => {
    const known = await api.searchKnownEntities({ query: "Moon" });
    assert.ok(
      known.results.some(
        (item) => item.title === "Moon เล่ม 1" && item.known && !item.owned,
      ),
    );
    await api.searchExternalTitles({ query: "Moon", sourceId: "phoenix" });
    assert.equal(requests, 1);
  });
});
