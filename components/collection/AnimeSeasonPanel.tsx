import {
  ANIME_SEASONS,
  animeSeasonLabel,
  currentAnimeSeason,
} from "../../lib/domain/anime.ts";
import { getTranslations } from "../../lib/server/preferences.ts";

export default async function AnimeSeasonPanel() {
  const t = await getTranslations();
  const { season, year } = currentAnimeSeason();
  return (
    <section id="seasonalDiscovery" aria-labelledby="seasonalTitle" hidden>
      <div className="anime-heading">
        <div>
          <p className="eyebrow">{t("From screen to shelf")}</p>
          <h2 id="seasonalTitle">{t("This season’s anime, in Thai")}</h2>
          <p className="release-note">
            {t(
              "Match seasonal anime to Thai manga and light novels. Browse publisher listings and add the Thai edition to your shelf.",
            )}
          </p>
        </div>
        <button id="refreshAnimeSeason" className="btn" type="button">
          {t("Refresh season")}
        </button>
      </div>
      <div className="anime-filters">
        <label className="field" htmlFor="animeSeason">
          <span>{t("Anime season")}</span>
          <select id="animeSeason" defaultValue={season}>
            {ANIME_SEASONS.map((value) => (
              <option key={value} value={value}>
                {t(animeSeasonLabel(value, year).split(" ")[0])}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="animeYear">
          <span>{t("Year")}</span>
          <input
            id="animeYear"
            type="number"
            min="1940"
            max={year + 1}
            defaultValue={year}
          />
        </label>
        <label className="field" htmlFor="animeBookType">
          <span>{t("Book type")}</span>
          <select id="animeBookType" defaultValue="Manga">
            <option value="">{t("Manga & novels")}</option>
            <option value="Manga">{t("Manga")}</option>
            <option value="LN">{t("Light novels")}</option>
          </select>
        </label>
        <label className="field" htmlFor="animeTranslation">
          <span>{t("Thai translations")}</span>
          <select id="animeTranslation" defaultValue="available">
            <option value="available">{t("Matched editions")}</option>
            <option value="all">{t("All linked books")}</option>
          </select>
        </label>
        <label className="field" htmlFor="animeAiring">
          <span>{t("Anime status")}</span>
          <select id="animeAiring">
            <option value="">{t("All in this season")}</option>
            <option value="RELEASING">{t("Airing now")}</option>
            <option value="NOT_YET_RELEASED">{t("Upcoming")}</option>
            <option value="FINISHED">{t("Finished")}</option>
          </select>
        </label>
        <label className="field anime-search" htmlFor="animeSeasonSearch">
          <span>{t("Search books or anime")}</span>
          <input
            id="animeSeasonSearch"
            type="search"
            placeholder={t("Thai, English, Japanese or romaji title…")}
          />
        </label>
      </div>
      <p className="hint">
        {t(
          "Anime relations from AniList; Thai editions checked against Phoenix Next, First Page Pro and Animag. Matches require a listed Thai book. Stock and pre-orders can change; a missing match does not rule out a Thai edition.",
        )}
      </p>
      <div
        id="animeThaiSources"
        className="anime-sources"
        aria-label={t("Thai catalog coverage")}
      />
      <div id="animeSeasonError" className="banner" role="alert" hidden />
      <p id="animeSeasonStatus" className="release-note" role="status" />
      <div id="animeSeasonList" className="anime-grid" />
    </section>
  );
}
