export default function AdaptationPanel({ series }: { series: string }) {
  return (
    <details id="adaptationPanel" className="adaptation-panel">
      <summary>
        Anime adaptations{" "}
        <span id="adaptationSummary" className="hint">
          Checking AniList…
        </span>
      </summary>
      <p className="hint">
        Check the original title on AniList. For translated titles, search in
        English, Japanese or romaji.
      </p>
      <form id="adaptationForm" className="anime-filters">
        <label className="field anime-search" htmlFor="adaptationSearch">
          <span>Title on AniList</span>
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
          <span>Book type</span>
          <select id="adaptationType">
            <option value="">Manga & light novels</option>
            <option value="Manga">Manga</option>
            <option value="LN">Light novels</option>
          </select>
        </label>
        <button id="findAdaptations" className="btn" type="submit">
          Find adaptations
        </button>
      </form>
      <div id="adaptationError" className="banner" role="alert" hidden />
      <p id="adaptationStatus" className="release-note" role="status" />
      <div id="adaptationList" className="anime-grid" />
    </details>
  );
}
