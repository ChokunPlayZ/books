import type { PriceAvailability, PriceOffer } from "../types.ts";

export function priceAvailability(value: unknown): PriceAvailability {
  const status = String(value || "")
    .split(/[\/#]/)
    .pop()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  if (["outofstock", "soldout", "discontinued"].includes(status))
    return "out_of_stock";
  if (["preorder", "presale", "backorder"].includes(status)) return "preorder";
  if (["instock", "limitedavailability", "onlineonly"].includes(status))
    return "in_stock";
  return "unknown";
}

export function lowestPrices(offers: PriceOffer[]) {
  const lowest = new Map<string, number>();
  for (const offer of offers) {
    if (offer.availability !== "in_stock" || offer.price === null) continue;
    lowest.set(
      offer.currency,
      Math.min(lowest.get(offer.currency) ?? Infinity, offer.price),
    );
  }
  return lowest;
}

export function sortPriceOffers(offers: PriceOffer[]) {
  const rank: Record<PriceAvailability, number> = {
    in_stock: 0,
    unknown: 1,
    preorder: 2,
    out_of_stock: 3,
  };
  return [...offers].sort(
    (a, b) =>
      a.currency.localeCompare(b.currency) ||
      rank[a.availability] - rank[b.availability] ||
      (a.price ?? Infinity) - (b.price ?? Infinity) ||
      a.shop.localeCompare(b.shop),
  );
}
