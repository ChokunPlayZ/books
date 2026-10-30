export function seedMetadataMaintenance(store) {
  for (const [isbn, series] of [
    ["9780316769488", "Maintenance one"],
    ["9780140328721", "Maintenance two"],
  ]) {
    store.api.saveBook({
      requestId: crypto.randomUUID(),
      book: {
        isbn,
        series,
        type: "Other",
        publisher: "",
        status: "Read",
        volume: 1,
        source: "",
        price: "",
        date: "",
        note: "",
      },
    });
  }
  store.cache.put(
    "isbn:v15:9780316769488",
    JSON.stringify({
      isbn: "9780316769488",
      found: true,
      details: { title: "Maintenance cached metadata", pageCount: 208 },
      checkedAt: new Date().toISOString(),
    }),
    86400,
  );
  store.cache.put(
    "scrape:v1:maintenance-page",
    JSON.stringify({
      source: "text:https://www.phoenixnext.com/book-series/example.html",
      checkedAt: Date.now(),
      value: "<p>Cached source page</p>",
    }),
    86400,
  );
  store.cache.put("cover:miss:v9:expired", "1", -1);
  store.cache.put("scrape:v1:maintenance:retry", "1", 900);
}
