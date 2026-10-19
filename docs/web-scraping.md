# Publisher catalogs and metadata

The Next.js server fetches publisher pages using native `fetch`. `lib/server/catalogs.ts` manages bounded requests, pagination and parsed catalog caches; `lib/server/scrape-cache.ts` shares durable SQLite page/API responses across scraping features. `lib/domain/releases.ts`, `titles.ts`, `urls.ts` and `html.ts` hold pure parsing and validation rules. Yaakz’s serialized product data is decoded in `lib/server/yaakz.ts`; gallery extraction lives in `lib/server/publisher-covers.ts`.

Requests have a 15-second timeout and an 8 MB response bound. Source and redirect allowlists reject unexpected hosts and credentials. External markup is parsed as data and never executed. The browser displays titles as text.

Publisher requests use the following freshness windows, defined in `SCRAPE_TTL`:

| Data                                            | Reuse window |
| ----------------------------------------------- | ------------ |
| Recent releases                                 | Six hours    |
| Series and discovery title catalogs             | 24 hours     |
| Publisher navigation/category directories       | Seven days   |
| Product details and cover galleries             | Seven days   |
| Exact-ISBN metadata, including confirmed misses | 24 hours     |
| Lookup results containing provider warnings     | 15 minutes   |

Successful catalog and page/API responses are retained for 30 days and survive restarts. Requests for the same resource share one in-flight operation, including concurrent refreshes. Shared results are copied before series-specific annotation. Opening the cover picker reuses catalogs and gallery pages instead of forcing another scrape. Stored image bytes remain permanent.

Explicit `refresh: true` bypasses fresh catalog and page/API entries. Failed requests impose a durable 15-minute cooldown on that resource, including explicit refreshes, so repeated views or restarts cannot hammer an unavailable source. HTTP errors and invalid JSON are not cached as successful responses. Failed catalog refreshes keep previous records and their original check time with a stale warning. Saved releases and explicit series links are independent database records, so cache expiry does not remove them. SQLite owns this cache; outgoing `fetch` still uses `no-store` to avoid an additional framework cache overriding refresh behavior.

## Dedicated series catalogs

Opening a series immediately renders gaps from the recorded shelf and calls `getSeriesCatalog({ series, publisherId, type, refresh })` for each supported publisher/type owned in that series. It does not call the recent-release feeds. Returning to a series reuses its loaded result. **Refresh catalog** reloads the shelf first, then bypasses catalog reuse and refreshes the category directory when finding an automatic match. Each response is stored under the requesting series and edition, so navigation during a fetch cannot show another series' result.

| Publisher      | Category discovery                                                              | Full-series source                                    | Pagination                                                                     |
| -------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| Phoenix Next   | Anchors in [the series directory](https://www.phoenixnext.com/book-series.html) | `/book-series/<slug>.html`                            | `?p=N`, at most 20 pages                                                       |
| First Page Pro | Category anchors in [the site navigation](https://www.firstpagepro.com/)        | `/category/<numeric-id>`                              | `?tskp=N`, at most 20 pages                                                    |
| Luckpim        | Full title search; its categories group formats and genres                      | `/get/search_pin/key?page=1&limit=-1&keyword=<title>` | The site's full search response, without the suggestions-only `take` parameter |
| Yen Press      | Paginated public series search index                                            | `/series/<slug>`                                      | Print-only `/series/get_more/<same-slug>` continuations, at most 20 pages      |

`parseSeriesCategories()` extracts category titles and allowed URLs. `matchSeriesCategory()` requires one exact normalized title or English slug match. A unique category ending with an explicit volume label such as `เล่ม 01` can also match the series without that suffix; numbers within series names are preserved. The same suffix rule applies when checking whether a linked category's listings are variants. First Page Pro's manga/light-novel URL prefixes identify the category format and disambiguate same-name categories. Normalization ignores punctuation, spacing, supported leading format labels and `@COMIC`; type is compared separately. It does not guess translations or choose a fuzzy match.

When no unique category matches, the response has `needsSelection: true`, category choices and `complete: false`. **Choose series category** searches these titles and URLs locally, or accepts a pasted URL. `setSeriesCatalog()` validates the publisher host/path and saves the explicit choice keyed by normalized shelf title, publisher ID and exact book type. Phoenix URLs must be HTTPS series-category paths; First Page Pro URLs are canonicalized to the numeric category root. Luckpim choices accept only its HTTPS `/search_result?k=<title>` URL. Arbitrary fetch URLs are rejected.

`fetchSeriesCategory_()` reuses the product-card parser described below. It reads Phoenix's `span.toolbar-number` or First Page Pro's `span.tsk-all` count, deduplicates product IDs, and requests more pages until the total is accounted for or the bounded traversal stops. `complete` is true only when unique extracted listings equal the reported total. Missing counts, repeated pages, extraction mismatches and the 20-page limit stay incomplete. An empty page without an explicit zero total is a failure. The category heading, falling back to the HTML title, supplies the publisher's series title. Live samples included 32 Phoenix listings for [ดอกรักผลิบานที่กลางใจ](https://www.phoenixnext.com/book-series/kaoru-hana-wa-rin-to-saku.html) and 11 First Page Pro listings for [ชิชุนกิจัง](https://www.firstpagepro.com/category/56), including older volumes.

`fetchLuckpimSeries_()` gets a fresh public token/cookie session from Luckpim's home page, then reads the full search endpoint. It requires HTTP 200, `status === 200`, an array in `data.list`, and a non-negative integer `data.total`. Extracted records must equal that total for a complete result. The shared Luckpim item parser supplies type, listed price and stock/pre-order labels. An empty search asks for the publisher's series title. It never substitutes the monthly new-release feed.

Catalog records retain `catalogSeries`, the local shelf title, so explicitly linked aliases compare and save under that title. A parsed title differing from both the category title and local title is marked `catalogVariant` for review. The browser groups normal unmatched volumes by publisher, exact type and volume, preserving alternate product links within the same card. Special sets, unknown/other editions, missing volume numbers and possible owned copies stay under **Check the edition**. These rules use the currently listed category, not a claim about every volume ever published; removed and out-of-print listings can be absent.

## Publisher sources and extraction

| Publisher ID | Source                                                                                           | Pagination                                            | Maximum scope per check          |
| ------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------- |
| `phoenix`    | [Phoenix Next new releases](https://www.phoenixnext.com/new-release.html)                        | First page, then `?p=2`                               | Two pages, capped at 72 listings |
| `firstpage`  | [First Page Pro new arrivals](https://www.firstpagepro.com/showroom/new)                         | First page, then `?tskp=2`                            | Two pages, capped at 40 listings |
| `luckpim`    | [Luckpim monthly new releases](https://www.luckpim.com/product/list/new) and its catalog request | `page=1` and, when needed, `page=2`, with `limit=100` | Up to 200 listings               |

These limits describe recent catalog listings. They do not provide a complete release history, and the lists can include pre-orders and special sets. `checkedAt` is the time the app successfully checked a feed, not a publication date.

### Phoenix Next

`fetchCatalog_()` downloads the two catalog pages. `parseCatalog('phoenix', html)` finds anchors whose class includes `product-item-link` and reads:

- The anchor text for the title and its `href` for the product URL.
- The first `data-price-amount` value in the associated card segment for the listed price.
- A 13-digit `isbnet` value in the card's BookWalker preview link, when present, for an ISBN candidate. The candidate must pass ISBN checksum validation.

The ISBN comes from the listing's preview link; the release fetch does not visit each Phoenix product page to verify its barcode. A sample preview-link ISBN was compared with the publisher's product-page barcode during the October 9 inspection. This relationship must be checked again if the site changes. Special sets discard this ISBN candidate so a regular volume's preview ISBN does not identify the entire set as owned.

Phoenix availability and release dates are left blank by this scraper. A missing price or ISBN remains blank; the scraper does not infer those values from the product slug.

### First Page Pro

`parseCatalog('firstpage', html)` splits the page at `div` elements with both `productArea` and `productItem` classes. Within each card, it reads the `gadgetThumbnail` anchor's `title` and `href`. The price comes from the anchor's HTML-encoded `GAEEPD` JSON attribute, specifically its `price` field.

Product URLs are reduced to `https://www.firstpagepro.com/product/<numeric-id>`. Removing the descriptive slug gives the same book a stable URL if its title spelling changes. The short URL was checked during the live inspection.

The current First Page Pro listing scraper does not extract an ISBN, availability, or release date. Series, volume, and type are derived from the title as described below.

### Luckpim

Luckpim's initial monthly page contains placeholders rather than its book records. `fetchLuckpim_()` follows the public catalog's normal request flow:

1. Fetch `/product/list/new` and extract the hidden `__RequestVerificationToken` input's `value`.
2. Read the initial response's `Set-Cookie` headers and retain only the cookie name/value pairs.
3. Request `https://www.luckpim.com/_api/getBookList?setting=new&page=1&limit=100`, sending the token as `XSRF-TOKEN` and the cookies as `Cookie`.
4. Require HTTP 200, `sc === 200`, and an array in `d.data`. Read page 2 if the first page has 100 records and `d.total` indicates more records.

The token and cookies belong to this public catalog request. They are obtained fresh when uncached book data is needed and held only for that fetch; the app does not reuse the user's browser cookies, log in to a publisher account, or persist those credentials. Luckpim caches parsed public book records rather than its token-bearing HTML or response headers, so cached series aliases share book data without replaying an old session.

| Luckpim field                         | App use                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `title`                               | Display title and series/volume parsing                                           |
| Numeric `slug`                        | Product link `/product/detail/<slug>`; records with a nonnumeric slug are skipped |
| `price_sale`, then `price`            | Listed price; `price` is used when `price_sale` is null or absent                 |
| `main_category`                       | Thai light-novel or manga type, when recognizable                                 |
| `pre_order === 'T'`                   | Availability label **Pre-order**                                                  |
| Positive `stock` when not a pre-order | Availability label **In stock**                                                   |
| Other stock values                    | **Check availability**                                                            |

The scraper does not use the response's rendered `html` or download cover images. It leaves ISBN and publication date blank. Pre-order start/end fields are not treated as publication dates. The live inspection read 148 listings across two pages; the number will change with the publisher's catalog.

## Common release data and normalization

`releaseItem()` converts publisher data into the record used by the browser and saved list:

| Field                      | Meaning                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `id`                       | Publisher ID plus a URL-safe SHA-256 digest of the canonical product URL |
| `publisherId`, `publisher` | Configured publisher ID and display name                                 |
| `title`                    | Decoded catalog title                                                    |
| `series`, `volume`, `type` | Parsed series, numeric volume, and Thai edition type when recognizable   |
| `url`                      | Publisher product-page link                                              |
| `isbn`                     | Checksum-valid canonical ISBN-13, or an empty string                     |
| `price`                    | Finite, non-negative listed price, including zero, or an empty string    |
| `special`                  | Whether title markers identify a special edition or set                  |
| `availability`             | Publisher-derived availability label, or an empty string                 |

`splitBookTitle()` decodes HTML entities and collapses whitespace. It recognizes markers such as `(LN)`, `นิยาย`, `มังงะ`, `การ์ตูน`, and `@COMIC`, removes supported leading format/pre-order labels, and looks for a volume following `เล่ม`, `เล่มที่`, `vol`, or `volume`. It also accepts a trailing number, optionally followed by parenthesized text such as `(จบ)` or supported promotional suffixes such as `แถมฟรี`. Decimal volumes such as `14.5` are preserved. These are title heuristics and can misread unusual names; they do not translate Thai and English series titles.

Special-edition detection recognizes markers including `Special Set`, `Complete Set`, `Box Set`, `Limited`, `เซต`, `ชุด`, and `ปกพิเศษ`. Such records have their ISBN candidate cleared and do not generate a normal-volume edition match. They still require review before being added to the shelf.

`safeProductUrl()` accepts only the configured publishers' HTTPS product URL patterns. `getPublisherReleases()` accepts a known publisher ID rather than a caller-supplied fetch URL. Saved releases are validated again by `cleanRelease()`. Phoenix and First Page Pro results are deduplicated by release ID after pagination; the browser also merges all feed and saved records by ID, preferring a current feed record over its saved snapshot.

## Naiin ISBN lookup

`lookupIsbn()` first validates the input and converts equivalent ISBN-10/ISBN-13 values to a canonical ISBN-13 for lookup and caching. `lookupNaiin_()` then:

1. Fetches `https://www.naiin.com/search-result?title=<canonical-isbn>`.
2. Reads the HTML-encoded JSON in the `:items` attribute of the first `product-list` element. This is embedded page data; the scraper does not run Vue or simulate search-box input.
3. Keeps candidates with `ProductTypeId === 1` and a numeric `ProductID`, and visits at most four candidate pages at `/product/detail/<ProductID>`.
4. Parses `application/ld+json` script contents as JSON, including arrays and `@graph` records. A candidate must have an exact canonical ISBN match in `isbn`, `gtin13`, or `sku`, or in the page's `book:isbn` meta tag. A search result alone is insufficient.
5. Returns the matched title, parsed series/volume/type, publisher, authors, product URL, and `book:release_date` when present. Publisher/author names can fall back to the search record after the detail page confirms the ISBN.

If Naiin has no confirmed candidate, the app tries Yaakz, Yen Press, Kinokuniya, Google Books, then Open Library. Yaakz verifies the ISBN of an individual product variant. Google Books also requires a matching ISBN in `industryIdentifiers`; Open Library is queried by the canonical ISBN key. Naiin and Kinokuniya search links remain available even if all metadata providers fail. Suggested details are reviewed in the form before saving.

An HTTP error or parsing failure ends that provider's attempt and adds an availability warning before trying the fallbacks. Candidate-page errors are not retried individually. Up to five Naiin requests are made per uncached lookup: one search and four detail pages. Each fallback uses its own bounded requests.

## Kinokuniya Thailand ISBN lookup and covers

The supplied [former storefront](https://thailand.kinokuniya.com/) redirects in a browser to [kinokuniya.co.th](https://kinokuniya.co.th/). The integration requests the current public storefront directly; it does not depend on the former site's redirect.

`lib/domain/kinokuniya.ts` parses representative product sections saved from the current storefront. Exact ISBN lookups request `/products/<canonical-isbn>`, then require both the displayed ISBN and the main product's structured `isbn`, `gtin`, or `gtin13` to match. The structured product URL must identify that same book; recommendations cannot supply its image. Publisher, authors and publication date come from the product details. The bookstore name remains the metadata source, while the original publisher is retained. Edition type remains blank because these multilingual pages do not reliably state the language and format; unstated volume numbers also remain blank.

Kinokuniya supplies automatic ISBN covers and additional **Pull covers** choices for any publisher and language when an ISBN is saved. Its image allowlist accepts only the current storefront's `/cdn/shop/` assets, which use the existing permanent cover storage. Choosing a bookstore cover preserves the saved publisher link. ISBN lookup and release cards also provide public Kinokuniya search links.

Successful lookups and confirmed misses, including HTTP 404, share a 24-hour durable cache. Source failures and changed markup use the existing 15-minute cooldown, including across refreshes and restarts; other metadata and cover providers continue working. ISBN and cover-miss cache versions were advanced so earlier misses do not hide the new provider.

## Yen Press ISBN lookup

`lib/domain/yenpress.ts` parses Yen Press's public search configuration, search records and book detail pages. `lookupYenPress_()` in `lib/server/catalogs.ts` follows the site's public search flow:

1. Fetch `https://yenpress.com/search` and read the JSON `_elastic` configuration without executing page scripts. Require the known Yen Press search host and engine. The public search key is used only for that request and is not persisted.
2. POST the canonical ISBN to `https://enterprise-search.yenpress.com/api/as/v1/engines/yenpress/search`, with the site's public search key and origin headers. Request at most four results using the ISBN search field. Search can return fuzzy matches, so candidates must state the exact canonical ISBN and use a validated HTTPS `/titles/<isbn>-<slug>` URL on `yenpress.com`.
3. Fetch at most four unique candidate pages. Read the labeled ISBN inside the `book-details` section and accept only the matching `detail-info` block. Print and digital editions can share a page but have different ISBNs and imprints; neither retailer links nor the active tab confirm an edition.
4. Read the title, series, volume, author names (including “Original author”), imprint and release date. The book's own category breadcrumb identifies `LN (EN)` or `Manga (EN)`; digital pages use the genre category in their book details when the breadcrumb only says “Digital eBooks”. Read the lazy-loaded `series cover` image, allowing only supported image hosts, including `images.yenpress.com`; the site's generic Open Graph image is not a cover.

Successful results and confirmed misses are shared across ISBN lookup and **Pull covers** for 24 hours, including across restarts. Product HTML uses the existing seven-day cache. Failures use the 15-minute retry cooldown and do not stop Google Books or Open Library fallback. Automatic ISBN cover lookup uses the same verified details.

The saved comic, digital and novel fixtures in `tests/fixtures/publishers/yenpress-*` preserve representative page sections from [Solo Leveling, Vol. 1](https://yenpress.com/titles/9781975319434-solo-leveling-vol-1-comic) and [Omniscient Reader's Viewpoint (novel), Vol. 1](https://yenpress.com/titles/9798400903526-omniscient-reader-s-viewpoint-novel-vol-1). The search bootstrap fixture substitutes a test public key.

## Yen Press publisher catalogs

`yenpress` is a configured publisher for releases, discovery, saved listings, series comparisons and cover selection. Server and browser matching recognize Yen Press, Yen On, Ize Press and JY as this catalog source. `lib/domain/yenpress-catalogs.ts` parses the public records; `lib/server/catalogs.ts` handles requests and shared caches.

- **Discovery and category choices:** query the public search index with `type: series`, excluding the Yen Audio imprint. Read up to 20 pages of 1,000 records, requiring stable totals, matching page numbers and unique record IDs. Deduplicate series URLs after accounting for every raw record. The directory supplies validated HTTPS series links and format hints from explicit title labels or the Yen On/Ize Press imprint. Formats without a confirmed hint are resolved from the series page as their cards approach the viewport. Manga/comics and novels remain separate discovery cards. A confirmed empty series is hidden; failed checks remain visible. Directory responses are reused for seven days and shared with automatic category matching.
- **Series catalogs:** accept only HTTPS `/series/<slug>` URLs on `yenpress.com`. Read the heading, its numbered-volume count, the category breadcrumb, and product links/images inside `#volumes-list`. Older volumes use the page’s `show-more` link. Continuation URLs must remain on the same series, contain a numeric `next_ord`, and use only Paperback/Hardback format parameters. Requests send the site’s AJAX header. Deduplicate products across at most 20 pages; repeated pages, missing counts and failed continuation requests stay incomplete. The heading counts numbered volumes, so unnumbered collector editions remain extra listings for review. A partial refresh retains an earlier complete catalog and its check time. Successful catalogs are reused for 24 hours.
- **Current releases:** read the current month from [the release calendar](https://yenpress.com/calendar). Keep at most 200 novel, manga and comic candidates, excluding chapter and audio listings. Confirm the candidate ISBNs in one public-index query restricted to `books-light-novels`, `books-manga` and `books-comics`; digital-only records are excluded. Require a complete response and use only validated book URLs. Read each cover and release date from its own calendar card. Prices stay blank rather than treating US/Canadian prices as baht. Release responses use the six-hour cache and retain previous successful listings during an outage.
- **Covers:** matched series volumes supply automatic covers even without a saved ISBN. The cover picker confirms the selected product’s ISBN, or its volume and format when no ISBN is recorded. Covers use the existing validated image storage and backup behavior.

Fixtures include a 15-volume comic series, a longer novel series with a collector edition and continuation page, paginated directory records, and a release calendar containing print, digital-only, chapter and audio examples. They cover source changes, unsafe links, incomplete pagination, offline reuse, publisher aliases and the publisher UI.

## Ownership and covers

`lib/client/matching.ts` contains the shelf-gap, release-ownership and discovery rules. ISBN matches use canonical ISBN-13 values. Series matching keeps publisher, language and format separate, while colored and regular manga share volume coverage. A single-volume special edition can satisfy its regular volume; multi-volume sets require review. Saved catalog aliases retain the mapping between a shelf title and the publisher’s name.

Cover discovery runs on the server. `lib/server/covers.ts` validates image bytes and stores them permanently in SQLite under content-based IDs. The browser requests `/api/covers/<id>`; it does not fetch publisher images directly. See `tests/integration/covers.test.mjs` for size bounds, redirects, persistence, backups and failed-source behavior.

## Maintaining a publisher

1. Save a minimal representative response under `tests/fixtures/publishers/` or `tests/fixtures/series-catalogs/`.
2. Update the parser and URL validation in `lib/domain/`; keep network behavior in `lib/server/catalogs.ts`.
3. Add a regression against the fixture in `tests/integration/`. Check pagination, exact editions, incomplete responses and stale-cache fallback.
4. Run `npm run check`, `npm run build` and `npm run test:e2e`. Browser scenarios use isolated temporary databases and fixed responses.

Fixture tests confirm the saved markup and application behavior. Live publisher markup can change; refresh a representative fixture when investigating a changed source.
