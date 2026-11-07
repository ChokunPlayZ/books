"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { canonicalIsbn } from "../../lib/domain/isbn.ts";
import { lowestPrices } from "../../lib/domain/prices.ts";
import type { PriceAvailability, PriceComparison } from "../../lib/types.ts";
import Icon from "../Icon";
import { usePreferences, useTranslations } from "../PreferencesProvider";
import { intlLocale } from "../../lib/preferences.ts";

const stockLabels: Record<PriceAvailability, string> = {
  in_stock: "In stock",
  out_of_stock: "Out of stock",
  preorder: "Pre-order",
  unknown: "Check availability",
};

function checkedTime(value: string, locale: string) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PriceFinder({
  initialIsbn = "",
}: {
  initialIsbn?: string;
}) {
  const t = useTranslations();
  const { preferences } = usePreferences();
  const locale = intlLocale(preferences.locale);
  const [isbn, setIsbn] = useState(initialIsbn);
  const [result, setResult] = useState<PriceComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);

  const search = useCallback(
    async (raw: string) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      const canonical = canonicalIsbn(raw);
      setError("");
      if (!canonical) {
        setResult(null);
        setLoading(false);
        setError(
          t(
            "Enter a valid ISBN-10 or ISBN-13. You can include spaces or hyphens.",
          ),
        );
        return;
      }
      setLoading(true);
      setResult(null);
      const url = new URL(window.location.href);
      url.searchParams.set("isbn", canonical);
      window.history.replaceState(null, "", url);
      try {
        const response = await fetch("/api/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "findLowestPrices",
            arg: { isbn: canonical },
          }),
          signal: controller.signal,
        });
        if (response.status === 401) {
          window.location.assign(
            "/login?returnTo=" + encodeURIComponent(url.pathname + url.search),
          );
          return;
        }
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            t(data.message || "Prices could not be checked. Try again."),
          );
        if (!controller.signal.aborted) setResult(data);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            t(
              cause instanceof Error
                ? cause.message
                : "Prices could not be checked. Try again.",
            ),
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (initialIsbn) void search(initialIsbn);
    return () => pending.current?.abort();
  }, [initialIsbn, search]);

  const lowest = lowestPrices(result?.offers || []);
  const unavailable =
    result?.sources.filter((source) => source.status === "unavailable") || [];
  return (
    <section className="price-finder" aria-labelledby="priceFinderTitle">
      <div className="release-heading">
        <div>
          <h1 id="priceFinderTitle">{t("Find the lowest price")}</h1>
          <p className="release-note">
            {t("Compare the same book across shops before you buy.")}
          </p>
        </div>
      </div>
      <form
        className="price-search"
        onSubmit={(event) => {
          event.preventDefault();
          void search(isbn);
        }}
      >
        <label className="field" htmlFor="priceSearchIsbn">
          <span>{t("Book ISBN")}</span>
          <input
            id="priceSearchIsbn"
            type="text"
            value={isbn}
            maxLength={40}
            autoComplete="off"
            enterKeyHint="search"
            placeholder={t("978… or ISBN-10")}
            aria-describedby={
              error ? "priceSearchHint priceSearchError" : "priceSearchHint"
            }
            aria-invalid={!!error}
            onChange={(event) => {
              pending.current?.abort();
              setIsbn(event.target.value);
              setResult(null);
              setError("");
              setLoading(false);
            }}
          />
        </label>
        <button className="btn primary" type="submit" disabled={loading}>
          <Icon name="wallet" />
          {t(loading ? "Checking shops…" : "Compare prices")}
        </button>
      </form>
      <p id="priceSearchHint" className="hint">
        {t(
          "Use the ISBN on the barcode to compare the same language, volume and edition.",
        )}
      </p>
      {error && (
        <p id="priceSearchError" className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="price-results" aria-busy={loading}>
        {loading && (
          <p className="price-search-status" role="status">
            {t(
              "Checking Naiin, Kinokuniya, Phoenix Next, First Page Pro, Animag and DEXpress…",
            )}
          </p>
        )}
        {!loading && !result && !error && (
          <div className="price-intro">
            <h2>{t("One ISBN. Six shops.")}</h2>
            <p>
              {t(
                "See listed prices and stock, with the lowest in-stock price highlighted. Open a shop to check delivery and place your order.",
              )}
            </p>
            <p className="hint">
              Naiin · Kinokuniya · Phoenix Next · First Page Pro · Animag ·
              DEXpress
            </p>
          </div>
        )}
        {result && (
          <>
            <div className="price-result-heading">
              <div>
                <h2>
                  {result.offers[0]?.title || t("No matching listings found")}
                </h2>
                <p className="hint">
                  ISBN {result.isbn} ·{" "}
                  {t(
                    result.offers.length === 1
                      ? "{count} shop with a matching listing"
                      : "{count} shops with a matching listing",
                    { count: result.offers.length },
                  )}
                </p>
              </div>
            </div>
            <p className="price-search-status" role="status">
              {t(
                result.offers.length
                  ? lowest.size
                    ? "Lowest in-stock prices are highlighted below."
                    : "No shop has confirmed this book is in stock. Check availability before ordering."
                  : unavailable.length === result.sources.length
                    ? "The shops could not be reached. Try again later or use the shop search links below."
                    : "No exact ISBN matches were found. Check the ISBN or try the shop search links below.",
              )}
            </p>
            {unavailable.length > 0 && (
              <p className="price-warning">
                {t(
                  "Could not check {shops}. The lowest price is based on the shops that responded.",
                  {
                    shops: unavailable.map((source) => source.name).join(", "),
                  },
                )}
              </p>
            )}
            {result.offers.length > 0 && (
              <ul
                className="price-offers"
                aria-label={t("Shop price comparison")}
              >
                {result.offers.map((offer) => {
                  const best =
                    offer.availability === "in_stock" &&
                    offer.price !== null &&
                    lowest.get(offer.currency) === offer.price;
                  return (
                    <li
                      key={offer.shopId}
                      className={
                        "price-offer" + (best ? " price-offer-best" : "")
                      }
                    >
                      <div className="price-offer-shop">
                        <h3>{offer.shop}</h3>
                        <p className="hint">
                          {t(stockLabels[offer.availability])}
                        </p>
                        <p className="hint">
                          {t("Checked")}{" "}
                          <time dateTime={offer.checkedAt}>
                            {checkedTime(offer.checkedAt, locale)}
                          </time>
                        </p>
                      </div>
                      <div className="price-offer-amount">
                        {offer.msrp != null && (
                          <p className="hint">
                            MSRP{" "}
                            {new Intl.NumberFormat(locale, {
                              style: "currency",
                              currency: offer.msrpCurrency || offer.currency,
                            }).format(offer.msrp)}
                          </p>
                        )}
                        <strong>
                          {offer.price === null
                            ? t("Price unavailable")
                            : new Intl.NumberFormat(locale, {
                                style: "currency",
                                currency: offer.currency,
                              }).format(offer.price)}
                        </strong>
                        {best && (
                          <span className="price-best-label">
                            {t("Lowest in stock")} · {offer.currency}
                          </span>
                        )}
                      </div>
                      <a
                        className={"btn" + (best ? " primary" : "")}
                        href={offer.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t(
                          "View book at {shop} (opens in a new tab)",
                          { shop: offer.shop },
                        )}
                      >
                        {t("View at shop ↗")}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="hint price-terms">
              {t(
                "Item prices exclude shipping, membership discounts and checkout coupons. Currencies are compared separately. Prices and stock may have changed since the time shown. Open the shop for current prices.",
              )}
            </p>
            <details className="price-sources">
              <summary>
                {t("All {count} shop checks", { count: result.sources.length })}
              </summary>
              <ul>
                {result.sources.map((source) => (
                  <li key={source.id}>
                    <div>
                      <strong>{source.name}</strong>
                      <p className="hint">
                        {t(
                          source.status === "found"
                            ? "Exact ISBN match"
                            : source.status === "not_found"
                              ? "No exact ISBN match"
                              : "Could not check · try again later",
                        )}
                      </p>
                    </div>
                    <a
                      href={source.searchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("Search shop ↗")}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
