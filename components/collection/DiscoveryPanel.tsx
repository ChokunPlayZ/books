import AnimeSeasonPanel from "./AnimeSeasonPanel";

export default function DiscoveryPanel() {
  return (
    <section id="discoverPanel" aria-label="Discover titles">
      <div className="release-heading">
        <div>
          <p className="eyebrow">Something new to love</p>
          <h1>Discover titles</h1>
          <p className="release-note">
            Find your next read in publisher catalogs or this season’s anime.
          </p>
        </div>
      </div>
      <label className="field discovery-mode" htmlFor="discoveryMode">
        <span>Browse</span>
        <select
          id="discoveryMode"
          aria-controls="publisherDiscovery seasonalDiscovery"
        >
          <option value="publisher">Publisher catalogs</option>
          <option value="anime">Current anime season · Thai editions</option>
        </select>
      </label>
      <AnimeSeasonPanel />
      <div id="publisherDiscovery">
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
              <option value="https://www.firstpagepro.com/category/22">
                First Page Pro · Manga (General)
              </option>
              <option value="https://www.firstpagepro.com/category/7">
                First Page Pro · Manga (18+)
              </option>
              <option value="https://www.firstpagepro.com/category/63">
                First Page Pro · Manga (20+)
              </option>
              <option value="https://www.yaakz.com/">
                Yaakz · New arrivals
              </option>
              <option value="https://yenpress.com/">
                Yen Press · All titles
              </option>
              <option value="https://www.kodansha.co.jp/comic/new-releases/p">
                Kodansha JP · Recent print comics
              </option>
              <option value="https://www.animagshop.com/">
                Animag · All titles
              </option>
              <option value="https://www.animagshop.com/category/1">
                Animag · A-Plus
              </option>
              <option value="https://www.animagshop.com/category/3">
                Animag · G-Plus
              </option>
              <option value="https://www.animagshop.com/category/2">
                Animag · Animag Books
              </option>
              <option value="https://www.animagshop.com/category/4">
                Animag · Animag Comics
              </option>
              <option value="https://www.animagshop.com/category/190">
                Animag · BeLOVED+
              </option>
              <option value="https://www.dexpress-shop.com/">
                DEXpress · All titles
              </option>
              <option value="https://www.dexpress-shop.com/category/2">
                DEXpress · Manga
              </option>
              <option value="https://www.dexpress-shop.com/category/3">
                DEXpress · Light novels
              </option>
              <option value="https://lily-house.com/shop-2/">
                Lily House · All titles
              </option>
              <option value="https://lily-house.com/product-category/manga/">
                Lily House · Manga
              </option>
              <option value="https://lily-house.com/product-category/novel/">
                Lily House · Novels
              </option>
              <option value="https://lily-house.com/product-category/english-book/">
                Lily House · English books
              </option>
              <option value="">Another category URL</option>
            </select>
          </label>
          <label
            id="discoveryCustom"
            className="field discovery-url"
            htmlFor="discoveryUrl"
            hidden
          >
            <span>Publisher category URL</span>
            <input
              id="discoveryUrl"
              type="url"
              required
              defaultValue="https://www.phoenixnext.com/gl.html"
              placeholder="Publisher catalog or series URL"
            />
          </label>
          <button
            id="loadDiscovery"
            className="btn primary"
            type="submit"
            hidden
          >
            Load titles
          </button>
          <button id="refreshDiscovery" className="btn" type="button">
            Refresh titles
          </button>
        </form>
        <div id="discoveryError" className="banner" role="alert" hidden></div>
        <div id="discoverySource" className="discovery-status"></div>
        <div className="toolbar discovery-filters">
          <div className="search">
            <svg aria-hidden="true">
              <use href="#i-search" />
            </svg>
            <label htmlFor="discoverySearch" className="sr-only">
              Search titles or look up a publisher ISBN
            </label>
            <input
              id="discoverySearch"
              type="search"
              placeholder="Search titles or enter an ISBN…"
            />
          </div>
          <label htmlFor="discoveryType" className="sr-only">
            Title type
          </label>
          <select id="discoveryType">
            <option value="">All types</option>
            <option value="Manga">Manga</option>
            <option value="LN">Light novels (LN)</option>
          </select>
        </div>
        <p className="hint">
          Enter an ISBN to search the full DEXpress, Animag, Phoenix Next or
          First Page Pro catalog. ISBN searches also include series already on
          your shelf.
        </p>
        <p id="discoveryCount" className="release-note" role="status"></p>
        <div id="discoveryList" className="discovery-grid"></div>
      </div>
    </section>
  );
}
