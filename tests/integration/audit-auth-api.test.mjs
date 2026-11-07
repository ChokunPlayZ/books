import test from "node:test";
import assert from "node:assert/strict";
import { openTestStore as openStore } from "../helpers/database.mjs";
import { createAccount } from "../../lib/server/auth.ts";
import { createApplicationApi } from "../../lib/server/api.ts";
import { digest } from "../../lib/domain.ts";

test("ordinary users cannot bypass refresh authorization with non-boolean JSON values", async (t) => {
  const store = await openStore();
  t.after(() => store.close());
  const reader = await createAccount(store, "reader", "reader@gmail.com");
  const url = "https://www.phoenixnext.com/gl.html";
  const cached = {
    url,
    publisherId: "phoenix",
    items: [],
    complete: true,
    checkedAt: new Date().toISOString(),
  };
  await store.cache.put(
    "publisher-catalog:v1:" + digest(url),
    JSON.stringify(cached),
    86400,
  );
  let requests = 0;
  const api = createApplicationApi(
    store,
    { ensure: () => assert.fail("No cover fetch expected") },
    async () => {
      requests++;
      return new Response('<div class="message info empty"></div>');
    },
  );
  await store.forUser(reader, async () => {
    for (const name of [
      "getPublisherCatalog",
      "getPublisherDirectory",
      "getPublisherTitle",
      "getPublisherReleases",
      "getBookCoverOptions",
      "searchPublisherIsbn",
    ])
      for (const refresh of ["true", "false", 1, 0, {}, [], null])
        await assert.rejects(api[name]({ url, refresh }), { status: 400 });
    await assert.rejects(api.getPublisherCatalog({ url, refresh: true }), {
      status: 403,
    });
    assert.equal((await api.getPublisherCatalog({ url })).complete, true);
    assert.equal(
      (await api.getPublisherCatalog({ url, refresh: false })).complete,
      true,
    );
  });
  assert.equal(requests, 0, "Rejected refreshes must not contact a source");
  await api.getPublisherCatalog({ url, refresh: true });
  assert.equal(requests, 1, "Administrators can still refresh a source");
});
