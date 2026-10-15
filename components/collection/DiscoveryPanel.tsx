export default function DiscoveryPanel() {
  return (
    <section id="discoverPanel" aria-label="Discover publisher titles" hidden>
      <div className="release-heading">
        <div>
          <p className="eyebrow">Something new to love</p>
          <h1>Discover titles</h1>
          <p className="release-note">
            Find series you haven’t started. One book per title, preferably
            volume 1.
          </p>
        </div>
        <button id="refreshDiscovery" className="btn">
          Refresh titles
        </button>
      </div>
      <form id="discoveryForm" className="discovery-source">
        <label className="field" htmlFor="discoveryPreset">
          <span>Browse a publisher category</span>
          <select
            id="discoveryPreset"
            defaultValue="https://www.phoenixnext.com/gl.html"
          >
            <option value="https://www.phoenixnext.com/book-series.html">
              Phoenix Next · All titles
            </option>
            <option value="https://www.phoenixnext.com/gl.html">
              Phoenix Next · Girl’s Love
            </option>
            <option value="https://www.phoenixnext.com/bl.html">
              Phoenix Next · Boy’s Love
            </option>
            <option value="https://www.phoenixnext.com/manga.html">
              Phoenix Next · Manga
            </option>
            <option value="https://www.phoenixnext.com/light-novel.html">
              Phoenix Next · Light novels
            </option>
            <option value="https://www.firstpagepro.com/">
              First Page Pro · All titles
            </option>
            <option value="https://www.yaakz.com/">Yaakz · New arrivals</option>
            <option value="">Another category URL</option>
          </select>
        </label>
        <label className="field discovery-url" htmlFor="discoveryUrl">
          <span>Publisher category URL</span>
          <input
            id="discoveryUrl"
            type="url"
            required
            defaultValue="https://www.phoenixnext.com/gl.html"
            placeholder="Phoenix Next, First Page Pro or Yaakz category URL"
          />
        </label>
        <button id="loadDiscovery" className="btn primary" type="submit">
          Load titles
        </button>
      </form>
      <p className="release-note">
        Titles come from the publisher’s navigation. Any series already on your
        shelf is hidden.
      </p>
      <div id="discoveryError" className="banner" role="alert" hidden></div>
      <div id="discoverySource" className="discovery-status"></div>
      <div className="toolbar release-filters">
        <div className="search">
          <svg aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <label htmlFor="discoverySearch" className="sr-only">
            Search discovered titles
          </label>
          <input
            id="discoverySearch"
            type="search"
            placeholder="Search titles…"
          />
        </div>
      </div>
      <p id="discoveryCount" className="release-note" role="status"></p>
      <div id="discoveryList" className="discovery-grid"></div>
    </section>
  );
}
