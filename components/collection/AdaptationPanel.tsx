import { getTranslations } from "../../lib/server/preferences.ts";

export default async function AdaptationPanel({ series }: { series: string }) {
  const t = await getTranslations();
  return (
    <details id="adaptationPanel" className="adaptation-panel">
      <summary>
        {t("Anime adaptations")}{" "}
        <span id="adaptationSummary" className="hint">
          {t("Checking AniList…")}
        </span>
      </summary>
      <p className="hint">
        {t(
          "Check the original title on AniList. For translated titles, search in English, Japanese or romaji.",
        )}
      </p>
      <form id="adaptationForm" className="anime-filters">
        <label className="field anime-search" htmlFor="adaptationSearch">
          <span>{t("Title on AniList")}</span>
          <input
            id="adaptationSearch"
            type="search"
            minLength={2}
            maxLength={200}
            defaultValue={series.slice(0, 200)}
            required
          />
        </label>
        <label className="field" htmlFor="adaptationType">
          <span>{t("Book type")}</span>
          <select id="adaptationType">
            <option value="">{t("Manga & light novels")}</option>
            <option value="Manga">{t("Manga")}</option>
            <option value="LN">{t("Light novels")}</option>
          </select>
        </label>
        <button id="findAdaptations" className="btn" type="submit">
          {t("Find adaptations")}
        </button>
      </form>
      <div id="adaptationError" className="banner" role="alert" hidden />
      <p id="adaptationStatus" className="release-note" role="status" />
      <div id="adaptationList" className="anime-grid" />
    </details>
  );
}
