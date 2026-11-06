import test from "node:test";
import assert from "node:assert/strict";
import { productMsrp, publisherYenMsrp } from "../../lib/domain/msrp.ts";
import { normalizeMsrp } from "../../lib/domain/validation.ts";

test("MSRP requires an explicit list price and never substitutes a sale price", () => {
  assert.equal(productMsrp("", { offers: { price: 90, highPrice: 200 } }), "");
  assert.equal(
    productMsrp("", {
      offers: {
        price: 90,
        priceSpecification: {
          priceType: "https://schema.org/ListPrice",
          price: "120.50",
        },
      },
    }),
    120.5,
  );
  assert.equal(
    productMsrp('<span data-price-type="oldPrice" data-price-amount="390">'),
    390,
  );
  assert.equal(publisherYenMsrp("定価：627円（本体570円）"), 627);
  assert.equal(normalizeMsrp(0), 0);
  assert.equal(normalizeMsrp(""), "");
  for (const value of [-1, NaN, Infinity, true, [], "free"])
    assert.throws(() => normalizeMsrp(value));
});
