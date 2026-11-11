"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "../PreferencesProvider";
import {
  formatMoney,
  languageName,
  volumePath,
} from "../../lib/domain/series-detail.ts";
import type { KnownVolume } from "../../lib/server/series-details.ts";

export default function VolumeIndex({
  series,
  types,
}: {
  series: string;
  types: string[];
}) {
  const t = useTranslations();
  const [items, setItems] = useState<KnownVolume[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      types.map(async (type) => {
        const response = await fetch("/api/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "getSeriesVolumes",
            arg: { series, type },
          }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.message ||
              "Volume details could not be loaded. Reload the page to try again.",
          );
        return result.items as KnownVolume[];
      }),
    )
      .then((groups) => {
        setItems(groups.flat());
        setError("");
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [series, types.join("|")]);
  return (
    <section className="series-volume-index" aria-labelledby="volumeIndexTitle">
      <h2 id="volumeIndexTitle">{t("Volume details")}</h2>
      <p className="hint">
        {t(
          "Open a volume for ISBN, prices, publication details, purchase history and other language editions. Includes known catalog volumes; this is not a complete publication list.",
        )}
      </p>
      {loading && <p role="status">{t("Loading volume details…")}</p>}
      {error && (
        <p role="alert" className="form-error">
          {t(error)}
        </p>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <a href={volumePath(series, item.key)}>
              <strong>
                {item.volume === "" || item.volume == null
                  ? t("Unnumbered volume")
                  : t("Volume {volume}", { volume: item.volume })}
              </strong>
              <span>
                {t(item.type)} · {t(languageName(item.language))}
                {item.publisher ? " · " + item.publisher : ""}
              </span>
              <span className="volume-index-isbn">
                {item.isbn ? "ISBN " + item.isbn : t("ISBN not recorded")}
              </span>
              <span>
                {formatMoney(item.msrp, item.msrpCurrency) ||
                  t("List price not recorded")}
              </span>
              <span className="status">
                {t(item.owned ? "Owned" : "Catalog")}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
