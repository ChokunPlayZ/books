import test from "node:test";
import assert from "node:assert/strict";
import { phoenixBook } from "../../lib/domain/phoenix.ts";
import { bookMetadata } from "../../lib/domain/validation.ts";
import { safeBookSourceUrl, safePublisherUrl } from "../../lib/domain/urls.ts";
import { luckpim } from "../../lib/server/scrapers/luckpim.ts";

test("Naiin edition sources survive learning the publisher without widening publisher host validation", () => {
  const source = "https://www.naiin.com/product/detail/648281";
  for (const publisher of ["", "Luckpim", "Phoenix Next"]) {
    assert.equal(safeBookSourceUrl(source, publisher), source);
    assert.equal(
      bookMetadata({ publisher, publisherUrl: source }).publisherUrl,
      source,
    );
  }
  assert.equal(safePublisherUrl(source, "Luckpim"), "");
  for (const value of [
    "http://www.naiin.com/product/detail/648281",
    "https://www.naiin.com.evil.test/product/detail/648281",
    "https://www.naiin.com@evil.test/product/detail/648281",
    "https://user:secret@www.naiin.com/product/detail/648281",
    "https://www.naiin.com:444/product/detail/648281",
    "https://www.naiin.com/redirect?url=https://evil.test",
    "https://www.naiin.com/product/detail/648281?url=https://evil.test",
    "https://www.naiin.com/product/detail/" + "1".repeat(2000),
    "https://evil.test/book",
  ])
    assert.equal(safeBookSourceUrl(value, "Luckpim"), "", value);
});

test("Phoenix promotional shop barcodes never borrow a preview ISBN or fail the entire crawl", () => {
  const url = "https://www.phoenixnext.com/mg0949-01p.html";
  const html = `<h1>(มังงะ) 15 นาทีก่อนที่เราจะเป็นแฟนกัน เล่ม 4 [แถมฟรี! Postcard]</h1>
    <div data-th="Barcode">1008000250112</div>
    <a href="https://bookwalker.in.th/web_rd/?isbnet=9786165999168">Preview</a>`;
  assert.equal(phoenixBook(html, "", url), null);
  assert.equal(phoenixBook(html, "9786165999168", url), null);
  assert.throws(
    () => phoenixBook("<h1>Broken markup</h1>", "", url),
    /ISBN details are unavailable/,
  );
  assert.equal(
    phoenixBook(html.replace("1008000250112", "9786165999168"), "", url)
      .isbnVerified,
    true,
  );
});

test("Luckpim application-level failures retain the endpoint and are not cached as confirmed misses", async () => {
  const url = "https://www.luckpim.com/get/search_pin/key?page=1";
  const source = luckpim.create({
    requestRemote: async (endpoint) =>
      endpoint.endsWith("/")
        ? {
            status: 200,
            body: '<input name="__RequestVerificationToken" value="private-token">',
            headers: {},
          }
        : {
            status: 200,
            url,
            body: JSON.stringify({
              status: 200,
              message: "fail",
              data: "error",
            }),
          },
  });
  await assert.rejects(source.searchTitles("No matching book"), (error) => {
    assert.equal(error.diagnostic.url, url);
    assert.match(
      error.message,
      /application-level.*not a confirmed empty search/,
    );
    assert.doesNotMatch(error.message, /private-token/);
    return true;
  });
});
