import { attr, textHtml } from "./html.ts";

export function money(value: unknown): number | "" {
  if (value == null || value === "") return "";
  const text = String(value).replace(/,/g, "").trim();
  return /^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text))
    ? Number(text)
    : "";
}

// Do not treat a discounted selling price, an aggregate highPrice, or another
// product's offer as the manufacturer's list price.
export function productMsrp(
  html: string,
  product?: Record<string, any>,
): number | "" {
  const offer = Array.isArray(product?.offers)
    ? product.offers[0]
    : product?.offers;
  const specifications = [offer?.priceSpecification].flat().filter(Boolean);
  for (const spec of specifications) {
    if (
      /^(?:https?:\/\/schema\.org\/)?(?:ListPrice|MSRP)$/i.test(
        spec.priceType || "",
      )
    ) {
      const price = money(spec.price);
      if (price !== "") return price;
    }
  }
  for (const value of [product?.msrp, product?.listPrice, offer?.listPrice]) {
    const price = money(value);
    if (price !== "") return price;
  }
  const tag = /<[^>]+\bdata-price-type=["']oldPrice["'][^>]*>/i.exec(html)?.[0];
  if (tag) return money(attr(tag, "data-price-amount"));
  const oldPrice =
    /<[^>]+\bclass=["'][^"']*\bproduct_price_old\b[^"']*["'][^>]*>/i.exec(
      html,
    )?.[0];
  return oldPrice ? money(attr(oldPrice, "realprice")) : "";
}

export function publisherYenMsrp(html: string): number | "" {
  return money(
    /定価\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*円/.exec(textHtml(html))?.[1],
  );
}
