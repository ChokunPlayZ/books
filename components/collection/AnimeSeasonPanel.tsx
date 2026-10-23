import {
  ANIME_SEASONS,
  animeSeasonLabel,
  currentAnimeSeason,
} from "../../lib/domain/anime.ts";

export default function AnimeSeasonPanel() {
  const { season, year } = currentAnimeSeason();
  return (
    <section id="seasonalDiscovery" aria-labelledby="seasonalTitle" hidden>
      <div className="anime-heading">
        <div>
          <p className="eyebrow">From screen to shelf</p>
          <h2 id="seasonalTitle">This season’s anime, in Thai</h2>
          <p className="release-note">
            Match seasonal anime to Thai manga and light novels. Browse
            publisher listings and add the Thai edition to your shelf.
          </p>
        </div>
        <button id="refreshAnimeSeason" className="btn" type="button">
          Refresh season
        </button>
      </div>
      <div className="anime-filters">
        <label className="field" htmlFor="animeSeason">
          <span>Anime season</span>
          <select id="animeSeason" defaultValue={season}>
            {ANIME_SEASONS.map((value) => (
              <option key={value} value={value}>
                {animeSeasonLabel(value, year).split(" ")[0]}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="animeYear">
          <span>Year</span>
          <input
            id="animeYear"
            type="number"
            min="1940"
            max={year + 1}
            defaultValue={year}
          />
        </label>
        <label className="field" htmlFor="animeBookType">
          <span>Book type</span>
          <select id="animeBookType" defaultValue="Manga">
            <option value="">Manga & novels</option>
            <option value="Manga">Manga</option>
            <option value="LN">Light novels</option>
          </select>
        </label>
        <label className="field" htmlFor="animeTranslation">
          <span>Thai translations</span>
          <select id="animeTranslation" defaultValue="available">
            <option value="available">Matched editions</option>
            <option value="all">All linked books</option>
          </select>
        </label>
        <label className="field" htmlFor="animeAiring">
          <span>Anime status</span>
          <select id="animeAiring">
            <option value="">All in this season</option>
            <option value="RELEASING">Airing now</option>
            <option value="NOT_YET_RELEASED">Upcoming</option>
            <option value="FINISHED">Finished</option>
          </select>
        </label>
        <label className="field anime-search" htmlFor="animeSeasonSearch">
          <span>Search books or anime</span>
          <input
            id="animeSeasonSearch"
            type="search"
            placeholder="Thai, English, Japanese or romaji title…"
          />
        </label>
      </div>
      <p className="hint">
        Anime relations from AniList; Thai editions checked against Phoenix Next
        and First Page Pro. Matches require a listed Thai book. Stock and
        pre-orders can change; a missing match does not rule out a Thai edition.
      </p>
      <div
        id="animeThaiSources"
        className="anime-sources"
        aria-label="Thai catalog coverage"
      />
      <div id="animeSeasonError" className="banner" role="alert" hidden />
      <p id="animeSeasonStatus" className="release-note" role="status" />
      <div id="animeSeasonList" className="anime-grid" />
    </section>
  );
}
