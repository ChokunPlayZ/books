import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { originalCoverUrl, safeCoverUrl } from "../../lib/domain/urls.ts";
import { phoenixBook } from "../../lib/domain/phoenix.ts";
import { parseCatalog } from "../../lib/domain/releases.ts";
import { publisherCovers } from "../../lib/server/publisher-covers.ts";

const origin = "https://www.phoenixnext.com";
const image = "/media/catalog/product/";
const cached = image + "cache/6517c62f5899ad6aa0ba23ceb3eeff97/";
const fixture = (name) =>
  readFileSync(
    new URL("../fixtures/publishers/" + name, import.meta.url),
    "utf8",
  );

test("Phoenix cover sources use originals while stored source validation preserves the thumbnail URL", () => {
  const thumbnail = origin + cached + "l/n/ln0838-01.jpg";
  const original = origin + image + "l/n/ln0838-01.jpg";
  assert.equal(originalCoverUrl(thumbnail), original);
  assert.equal(
    originalCoverUrl(cached + "l/n/ln0838-01.jpg", origin),
    original,
  );
  assert.equal(originalCoverUrl(original), original);
  assert.equal(safeCoverUrl(thumbnail), thumbnail);
  const other = "https://www.firstpagepro.com" + cached + "cover.jpg";
  assert.equal(originalCoverUrl(other), other);
  for (const url of [
    "https://www.phoenixnext.com.evil.test" + cached + "cover.jpg",
    "https://user:password@www.phoenixnext.com" + cached + "cover.jpg",
    "https://www.phoenixnext.com:444" + cached + "cover.jpg",
  ])
    assert.equal(originalCoverUrl(url), "");
});

test("Phoenix ISBN metadata, listing images and gallery choices resolve to unpadded originals", () => {
  const product = origin + "/ln0838-01.html";
  assert.equal(
    phoenixBook(fixture("phoenix-isbn-product.html"), "9786166247404", product)
      .coverUrl,
    origin + image + "l/n/ln0838-01.jpg",
  );
  const listings = parseCatalog(
    "phoenix",
    `<a href="${product}"><img src="${origin + cached}l/n/ln0838-01.jpg"></a><a class="product-item-link" href="${product}">(LN) เส้นทางจาริกอาถรรพ์</a>`,
  );
  assert.equal(listings[0].coverUrl, origin + image + "l/n/ln0838-01.jpg");
  assert.deepEqual(
    publisherCovers(
      fixture("phoenix-revised-volume.html"),
      origin + "/mg0435-02.html",
    ),
    [origin + image + "_/m/_m_kaoru_hana_vol1_jacket_cover_1.jpg"],
  );
});
