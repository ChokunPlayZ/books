# Web scraping: series catalogs, release feeds and ISBN lookup

## Standalone Next.js runtime

The main app now runs on Next.js and SQLite. The source-specific parsing rules below are retained, with pure parsers in `lib/domain.mjs` and asynchronous fetch/caching in `lib/server/catalogs.mjs`. Native `fetch` replaces `UrlFetchApp`; SQLite replaces Script Cache and the helper tabs. Each response has a 15-second timeout and an 8 MB bound. Catalog links and product URLs still pass the existing publisher allowlists.

`lib/server/store.mjs` stores saved releases and category choices independently from disposable caches. Successful feed results are retained for seven days, with a one-hour freshness window. Series/directory caches use the same policy. On a failed refresh, a retained result stays marked stale with its original check time. Exact ISBN metadata is cached for six hours.

Google Sheets helper tabs are migration inputs only. The workbook importer copies them into the database. The app does not call Sheets or Apps Script at runtime. The remainder of this guide includes the previous Apps Script storage notes for the retained legacy implementation; use the files above when maintaining the standalone app.

Native Node requests were checked on October 9, 2026: Phoenix returned 72 releases, First Page Pro 40, Luckpim 148, and Naiin verified ISBN `9786166247275`.

### Title discovery and covers (standalone app)

**Discover titles** uses the publisher’s navigation as the directory rather than deriving series names from recent product listings. Phoenix supports `/book-series.html`, `/gl.html`, `/bl.html`, `/manga.html`, and `/light-novel.html`; First Page Pro uses its home-page category tree. `parsePublisherTitles_()` restricts Phoenix links to the selected navigation branch, strips listing counts, and merges duplicate title names. First Page navigation paths identify parent categories, which are excluded from its full title directory, and supply manga/light-novel format hints. Pasted supported series categories can also be browsed.

`getPublisherDirectory()` caches these directories under `publisher-directory:v1:<URL digest>`. The browser filters out any title with an owned volume, recognizing publisher aliases and saved category names. It resolves visible titles using `getPublisherTitle()`, with at most three concurrent browser requests. That action reads the title’s category links through `getPublisherCatalog()`, deduplicates product IDs across up to 20 pages, and selects regular volume 1, then another single-volume edition of volume 1, then the earliest ordinary listing. Sets rank last. One-shots remain unnumbered. The directory name supplies a stable card title and shelf name, so promotional sets and reprints do not create extra discovery cards. Each source is publisher-allowlisted before fetching.

Directory and discovery category results have a 24-hour freshness window and seven-day SQLite retention. Failed refreshes retain previous successful results and their check times. An incomplete refresh does not replace a previously complete category. Missing totals, repeated pages, the page bound, and failures after the first page remain incomplete. Phoenix’s toolbar contains first-item, last-item and total spans; the parser uses the greatest count. First Page’s canonical numeric category URLs redirect to Thai named paths: the fetcher restores raw UTF-8 `Location` header bytes and follows up to three HTTPS redirects only within the same publisher category/product ID. Other redirects are rejected.

Publisher covers are paired with their own product link (Phoenix places the image before the title anchor). First Page uses the lazy image’s `data-src`; Luckpim uses its thumbnail generation path. Exact-ISBN lookup now includes Naiin structured/OG images, Google Books image links, and Open Library covers. Metadata cache keys use `isbn:v3:<ISBN>`. Supported HTTPS cover URLs survive saved-release snapshots and JSON backups. Browser images use lazy loading, fixed image areas, and a fallback placeholder on errors.

`getBookCover({row})` resolves only an existing owned/removed library record. Catalog covers are indexed by canonical ISBN or publisher/series/type/volume for 30 days. Known set/variant covers do not populate ordinary volume indexes. Missing ISBN images are looked up only when needed, with concurrent lookups deduplicated; confirmed misses are cached for one day. Image files load directly from the supported source hosts. These caches are disposable and excluded from logical backups.

Live checks on October 14, 2026 found 431 Phoenix titles in its full navigation and 51 distinct titles in its GL navigation. The GL product catalog had 299 listings over nine pages, all with cover URLs. Navigation can include titles without current listings; the UI keeps their category links and reports unavailable covers. `tests/app/discovery.test.mjs` covers navigation, pagination, ownership, edition selection, persistence, redirects and cover validation; `tests/discovery.browser.mjs` runs against an isolated production Next.js instance as part of `npm run test:e2e`.


The deployed app reads dedicated publisher series catalogs for **What you're missing**, recent catalogs for **New releases**, and Naiin book pages to look up an ISBN. This guide describes the current implementation, its data limits, and how to repair it when a site changes. The public pages and catalog requests were inspected on **October 9, 2026**. The selectors and endpoints below are dependencies of this implementation, rather than a guarantee of a stable API from the publishers.

## Where the scraping runs

All live website requests run in Google Apps Script through `UrlFetchApp` in [Code.gs](../apps-script/Code.gs). The browser calls Apps Script through `google.script.run` and receives ordinary data objects. It does not download or execute the publisher websites' JavaScript, and there is no headless browser or scraper server to install. The existing manifest already includes `script.external_request` permission.

[Index.html](../apps-script/Index.html) owns the release filters, shelf comparisons, and display. It renders scraped titles as text, rather than inserting the publishers' HTML into the app.

On the first visit to **New releases** in a page session, `loadReleases()` sends one `getPublisherReleases({ publisherId, refresh: false })` request per publisher concurrently. Pagination within each publisher request is sequential. Returning to the tab in the same session uses the already loaded results. **Refresh releases** reloads the shelf and then requests all three feeds with `refresh: true`. If the shelf cannot refresh, the app warns that ownership labels use the previously loaded collection.

There is no background schedule, email notification, or automatic crawl of every product page. Release search and filtering happen in the browser against the loaded data.

## Dedicated series catalogs

Opening a series immediately renders gaps from the recorded shelf and calls `getSeriesCatalog({ series, publisherId, type, refresh })` for each supported publisher/type owned in that series. It does not call the recent-release feeds. Returning to a series reuses its loaded result. **Refresh catalog** reloads the shelf first, then bypasses catalog reuse. Each response is stored under the requesting series and edition, so navigation during a fetch cannot show another series' result.

| Publisher | Category discovery | Full-series source | Pagination |
|---|---|---|---|
| Phoenix Next | Anchors in [the series directory](https://www.phoenixnext.com/book-series.html) | `/book-series/<slug>.html` | `?p=N`, at most 20 pages |
| First Page Pro | Category anchors in [the site navigation](https://www.firstpagepro.com/) | `/category/<numeric-id>` | `?tskp=N`, at most 20 pages |
| Luckpim | Full title search; its categories group formats and genres | `/get/search_pin/key?page=1&limit=-1&keyword=<title>` | The site's full search response, without the suggestions-only `take` parameter |

`parseSeriesCategories_()` extracts category titles and allowed URLs. `matchSeriesCategory_()` requires one exact normalized title or English slug match. First Page Pro's manga/light-novel URL prefixes identify the category format and disambiguate same-name categories. Normalization ignores punctuation, spacing, supported leading format labels and `@COMIC`; type is compared separately. It does not guess translations or choose a fuzzy match.

When no unique category matches, the response has `needsSelection: true`, category choices and `complete: false`. **Choose series category** searches these titles and URLs locally, or accepts a pasted URL. `setSeriesCatalog()` validates the publisher host/path and saves the explicit choice keyed by normalized shelf title, publisher ID and exact book type. Phoenix URLs must be HTTPS series-category paths; First Page Pro URLs are canonicalized to the numeric category root. Luckpim choices accept only its HTTPS `/search_result?k=<title>` URL. Arbitrary fetch URLs are rejected.

`fetchSeriesCategory_()` reuses the product-card parser described below. It reads Phoenix's `span.toolbar-number` or First Page Pro's `span.tsk-all` count, deduplicates product IDs, and requests more pages until the total is accounted for or the bounded traversal stops. `complete` is true only when unique extracted listings equal the reported total. Missing counts, repeated pages, extraction mismatches and the 20-page limit stay incomplete. An empty page without an explicit zero total is a failure. The category heading, falling back to the HTML title, supplies the publisher's series title. Live samples included 32 Phoenix listings for [ดอกรักผลิบานที่กลางใจ](https://www.phoenixnext.com/book-series/kaoru-hana-wa-rin-to-saku.html) and 11 First Page Pro listings for [ชิชุนกิจัง](https://www.firstpagepro.com/category/56), including older volumes.

`fetchLuckpimSeries_()` gets a fresh public token/cookie session from Luckpim's home page, then reads the full search endpoint. It requires HTTP 200, `status === 200`, an array in `data.list`, and a non-negative integer `data.total`. Extracted records must equal that total for a complete result. The shared Luckpim item parser supplies type, listed price and stock/pre-order labels. An empty search asks for the publisher's series title. It never substitutes the monthly new-release feed.

Catalog records retain `catalogSeries`, the local shelf title, so explicitly linked aliases compare and save under that title. A parsed title differing from both the category title and local title is marked `catalogVariant` for review. The browser groups normal unmatched volumes by publisher, exact type and volume, preserving alternate product links within the same card. Special sets, unknown/other editions, missing volume numbers and possible owned copies stay under **Check the edition**. These rules use the currently listed category, not a claim about every volume ever published; removed and out-of-print listings can be absent.

## Publisher sources and extraction

| Publisher ID | Source | Pagination | Maximum scope per check |
|---|---|---|---|
| `phoenix` | [Phoenix Next new releases](https://www.phoenixnext.com/new-release.html) | First page, then `?p=2` | Two pages, capped at 72 listings |
| `firstpage` | [First Page Pro new arrivals](https://www.firstpagepro.com/showroom/new) | First page, then `?tskp=2` | Two pages, capped at 40 listings |
| `luckpim` | [Luckpim monthly new releases](https://www.luckpim.com/product/list/new) and its catalog request | `page=1` and, when needed, `page=2`, with `limit=100` | Up to 200 listings |

These limits describe recent catalog listings. They do not provide a complete release history, and the lists can include pre-orders and special sets. `checkedAt` is the time the app successfully checked a feed, not a publication date.

### Phoenix Next

`fetchCatalog_()` downloads the two catalog pages. `parseCatalog_('phoenix', html)` finds anchors whose class includes `product-item-link` and reads:

- The anchor text for the title and its `href` for the product URL.
- The first `data-price-amount` value in the associated card segment for the listed price.
- A 13-digit `isbnet` value in the card's BookWalker preview link, when present, for an ISBN candidate. The candidate must pass ISBN checksum validation.

The ISBN comes from the listing's preview link; the release fetch does not visit each Phoenix product page to verify its barcode. A sample preview-link ISBN was compared with the publisher's product-page barcode during the October 9 inspection. This relationship must be checked again if the site changes. Special sets discard this ISBN candidate so a regular volume's preview ISBN does not identify the entire set as owned.

Phoenix availability and release dates are left blank by this scraper. A missing price or ISBN remains blank; the scraper does not infer those values from the product slug.

### First Page Pro

`parseCatalog_('firstpage', html)` splits the page at `div` elements with both `productArea` and `productItem` classes. Within each card, it reads the `gadgetThumbnail` anchor's `title` and `href`. The price comes from the anchor's HTML-encoded `GAEEPD` JSON attribute, specifically its `price` field.

Product URLs are reduced to `https://www.firstpagepro.com/product/<numeric-id>`. Removing the descriptive slug gives the same book a stable URL if its title spelling changes. The short URL was checked during the live inspection.

The current First Page Pro listing scraper does not extract an ISBN, availability, or release date. Series, volume, and type are derived from the title as described below.

### Luckpim

Luckpim's initial monthly page contains placeholders rather than its book records. `fetchLuckpim_()` follows the public catalog's normal request flow:

1. Fetch `/product/list/new` and extract the hidden `__RequestVerificationToken` input's `value`.
2. Read the initial response's `Set-Cookie` headers and retain only the cookie name/value pairs.
3. Request `https://www.luckpim.com/_api/getBookList?setting=new&page=1&limit=100`, sending the token as `XSRF-TOKEN` and the cookies as `Cookie`.
4. Require HTTP 200, `sc === 200`, and an array in `d.data`. Read page 2 if the first page has 100 records and `d.total` indicates more records.

The token and cookies belong to this public catalog request. They are obtained fresh for a fetch and held only in that Apps Script execution; the app does not reuse the user's browser cookies, log in to a publisher account, or store these values in the spreadsheet or cache.

| Luckpim field | App use |
|---|---|
| `title` | Display title and series/volume parsing |
| Numeric `slug` | Product link `/product/detail/<slug>`; records with a nonnumeric slug are skipped |
| `price_sale`, then `price` | Listed price; `price` is used when `price_sale` is null or absent |
| `main_category` | Thai light-novel or manga type, when recognizable |
| `pre_order === 'T'` | Availability label **Pre-order** |
| Positive `stock` when not a pre-order | Availability label **In stock** |
| Other stock values | **Check availability** |

The scraper does not use the response's rendered `html` or download cover images. It leaves ISBN and publication date blank. Pre-order start/end fields are not treated as publication dates. The live inspection read 148 listings across two pages; the number will change with the publisher's catalog.

## Common release data and normalization

`releaseItem_()` converts publisher data into the record used by the browser and saved list:

| Field | Meaning |
|---|---|
| `id` | Publisher ID plus a URL-safe SHA-256 digest of the canonical product URL |
| `publisherId`, `publisher` | Configured publisher ID and display name |
| `title` | Decoded catalog title |
| `series`, `volume`, `type` | Parsed series, numeric volume, and Thai edition type when recognizable |
| `url` | Publisher product-page link |
| `isbn` | Checksum-valid canonical ISBN-13, or an empty string |
| `price` | Finite, non-negative listed price, including zero, or an empty string |
| `special` | Whether title markers identify a special edition or set |
| `availability` | Publisher-derived availability label, or an empty string |

`splitBookTitle_()` decodes HTML entities and collapses whitespace. It recognizes markers such as `(LN)`, `นิยาย`, `มังงะ`, `การ์ตูน`, and `@COMIC`, removes supported leading format/pre-order labels, and looks for a volume following `เล่ม`, `เล่มที่`, `vol`, or `volume`. It also accepts a trailing number, optionally followed by parenthesized text such as `(จบ)` or supported promotional suffixes such as `แถมฟรี`. Decimal volumes such as `14.5` are preserved. These are title heuristics and can misread unusual names; they do not translate Thai and English series titles.

Special-edition detection recognizes markers including `Special Set`, `Complete Set`, `Box Set`, `Limited`, `เซต`, `ชุด`, and `ปกพิเศษ`. Such records have their ISBN candidate cleared and do not generate a normal-volume edition match. They still require review before being added to the shelf.

`safeProductUrl_()` accepts only the configured publishers' HTTPS product URL patterns. `getPublisherReleases()` accepts a known publisher ID rather than a caller-supplied fetch URL. Saved releases are validated again by `cleanRelease_()`. Phoenix and First Page Pro results are deduplicated by release ID after pagination; the browser also merges all feed and saved records by ID, preferring a current feed record over its saved snapshot.

## Naiin ISBN lookup

`lookupIsbn()` first validates the input and converts equivalent ISBN-10/ISBN-13 values to a canonical ISBN-13 for lookup and caching. `lookupNaiin_()` then:

1. Fetches `https://www.naiin.com/search-result?title=<canonical-isbn>`.
2. Reads the HTML-encoded JSON in the `:items` attribute of the first `product-list` element. This is embedded page data; the scraper does not run Vue or simulate search-box input.
3. Keeps candidates with `ProductTypeId === 1` and a numeric `ProductID`, and visits at most four candidate pages at `/product/detail/<ProductID>`.
4. Parses `application/ld+json` script contents as JSON, including arrays and `@graph` records. A candidate must have an exact canonical ISBN match in `isbn`, `gtin13`, or `sku`, or in the page's `book:isbn` meta tag. A search result alone is insufficient.
5. Returns the matched title, parsed series/volume/type, publisher, authors, product URL, and `book:release_date` when present. Publisher/author names can fall back to the search record after the detail page confirms the ISBN.

If Naiin has no confirmed candidate, the app tries Google Books, then Open Library. Google Books also requires a matching ISBN in `industryIdentifiers`; Open Library is queried by the canonical ISBN key. A Naiin search link remains available even if all metadata providers fail. Suggested details are reviewed in the form before saving.

An HTTP error or parsing failure ends that Naiin attempt and adds an availability warning before trying the fallbacks. Candidate-page errors are not retried individually. Up to five Naiin requests are made per uncached lookup: one search and four detail pages. Fallback providers can add two more requests.

## Caching and failure handling

| Data | Cache key | Reuse and retention |
|---|---|---|
| Publisher feed | `releases:v1:<publisher-id>` | Reuse a successful check younger than one hour unless `refresh: true`; request six-hour cache retention |
| Series catalog | `series:v1:<publisher-id>:<digest of series, type, chosen URL>` | Reuse a check younger than one hour unless refreshed; request six-hour retention |
| Category directory | `series-directory:v1:<publisher-id>` | Reuse a check younger than one hour unless refreshed; request six-hour retention |
| Successful ISBN lookup | `isbn:v2:<canonical-isbn>` | Request six-hour retention; unsuccessful lookups are not cached |

Publisher/catalog caching is skipped unless `JSON.stringify(result).length * 3 < 95000`. This is a conservative size check; large directories can be too large to cache. Cache retention is best effort, so a previous result is not guaranteed to remain available.

Each feed response contains `publisherId`, `items`, `checkedAt`, `stale`, and `error`. An HTTP failure, invalid Luckpim response, or a feed with no usable first-page listings produces an unavailable result. If a previous successful cached feed exists, it is returned with `stale: true`, its original `checkedAt`, and a refresh warning. Otherwise the result has no items or check time and an explanation. A second Phoenix/First Page Pro page with zero parsed listings ends pagination; an HTTP exception on that page fails that publisher's refresh.

The browser handles each publisher independently, so one failed feed does not hide successful feeds. A failed browser-to-Apps-Script request can also retain that publisher's previously loaded items in the current session. The code has bounded page counts and caching, but no additional HTTP retry loop, exponential backoff, custom fetch timeout, or per-host rate limiter.

Series responses also include `series`, `type`, `title`, `url`, `total`, `pages`, `complete` and `needsSelection`. A failed refresh keeps the previous cached catalog and its original check time with `stale: true`; otherwise it reports unavailable rather than an empty successful catalog. A partially counted result has a check time but `complete: false` and a warning. The browser keeps all such source warnings visible even when some missing volumes were found.

The HTML readers use regular expressions tied to the current markup, rather than a general HTML parser. Partial extraction can succeed even if some cards stop matching. A plausible nonzero result therefore does not prove that all expected listings were captured.

## What is sent and stored

Catalog fetches send category URLs and, for Luckpim, a series search title and temporary public token/cookies. ISBN lookup sends the requested ISBN in a search/API URL and visits candidate product IDs. The app does not send the user's complete shelf, notes, spending, or scanned photographs to these publishers or metadata providers. Barcode/photo recognition runs in the browser; only the ISBN goes to metadata lookup.

Fetched HTML and catalog tokens are not persisted by the app. The cache contains normalized feed or lookup results. **Save for later** writes a normalized release snapshot to the hidden `_BookAppReleases` sheet with columns `Release ID`, `State`, `Book JSON`, and `Updated At`. Saved snapshots survive feed changes and cache eviction. `saved`/`unsaved` writes are keyed by the stable release ID, so repeating the same state does not create another saved entry. Saving a release does not write an owned book or purchase price.

Explicit category choices are stored in the lazily created hidden `_BookAppSeriesCatalogs` sheet with columns `Series`, `Publisher ID`, `Type`, `Catalog URL`, and `Catalog Title`. Repeated choices update the same matching row, and different formats keep separate choices. Writes use explicit string cells and a script lock; they never change the owned-book columns. Catalog-series aliases and variant flags are also retained when saving a catalog listing for later.

## How scraped data determines “Not bought yet”

`releaseMatches()` in [Index.html](../apps-script/Index.html) compares each release against the loaded shelf:

- An equivalent checksum-valid ISBN gives **On your shelf · ISBN match**.
- A non-special release with a known volume can give **Volume on your shelf · Check the edition** when the normalized series and publisher match and the type matches whenever the release has a known type. Series normalization applies Unicode NFKC, lowercases, removes supported leading format labels, and ignores punctuation/spacing. Publisher aliases recognize Phoenix, First Page Pro, and Luckpim in supported English/Thai spellings.
- A release with neither match appears in **Not bought yet**. Possible edition matches are excluded from that default view and can be inspected using **Check edition**.

Missing shelf records/ISBNs, unknown types, title translations, unusual volume names, and special editions can affect these results. Catalog prices and “no match” labels are suggestions for review; buying or owning a book is recorded only when the user saves a book to the collection.

## Tests and maintenance

The reduced fixtures in [tests/fixtures/publishers](../tests/fixtures/publishers) and [tests/fixtures/series-catalogs](../tests/fixtures/series-catalogs) preserve the markup/JSON needed by the adapters. Luckpim token/cookie test values are synthetic. [publishers.test.mjs](../tests/publishers.test.mjs) exercises recent feeds and Naiin; [series-catalogs.test.mjs](../tests/series-catalogs.test.mjs) exercises directories, full categories, older volumes, pagination/count failures, saved choices and full Luckpim search. Run them without network access:

```sh
node --test tests/publishers.test.mjs tests/series-catalogs.test.mjs
```

[publishers.browser.mjs](../tests/publishers.browser.mjs) checks filters and ownership labels, saved records across refresh/reload, add-form review, partial feed failures, Naiin form filling, text rendering, and phone/desktop layout against the local preview. Start the preview separately and use the browser environment settings documented in [README.md](../README.md#local-development):

```sh
node preview/server.mjs
node tests/publishers.browser.mjs
```

The preview serves fixed examples from [preview/releases.json](../preview/releases.json), labeled catalog snapshots in [preview/series-catalogs.json](../preview/series-catalogs.json), category-directory fixtures, and a Naiin fixture for ISBN `9786166247275`. It does not scrape the live publishers; categories without snapshots show an unavailable-sample warning. [series-missing.browser.mjs](../tests/series-missing.browser.mjs) checks the series flow, category choices/reload, missing volumes, uncertain editions, failure handling and responsive layouts using an isolated collection. The test harness simulates `UrlFetchApp` and cache storage; it does not test real Apps Script network access, cache expiration/eviction, or Google's deployed authorization. Passing these tests confirms behavior against the fixtures, not that today's live site still has the same markup.

When a feed stops working or seems incomplete:

1. Open the relevant source page and inspect the current response or the browser's catalog request. Check the card markup, next-page parameter, response fields, and token/cookie flow against the adapter above.
2. Capture small representative fixtures with Thai text, a normal volume, and a special/pre-order example where applicable. Replace any live token/cookies with synthetic test values; keep unrelated page scripts and descriptions out of fixtures.
3. Update the relevant function in `Code.gs`: `parseCatalog_()`/`fetchCatalog_()` for recent Phoenix or First Page Pro listings; `parseSeriesCategories_()`/`catalogTotal_()`/`fetchSeriesCategory_()` for series categories; `fetchLuckpim_()` or `fetchLuckpimSeries_()` for the corresponding Luckpim flow; or `lookupNaiin_()`/`structuredBooks_()` for Naiin. Adjust `splitBookTitle_()` only when the title format itself changed.
4. Run the fixture tests, then inspect a fresh live result, including page 2 and sample product links. For Naiin, verify that an exact ISBN is accepted and a mismatched edition is rejected. Preserve the bounds and exact-ISBN checks when repairing a parser.
5. If the response schema changes, update the browser and saved-record handling as needed and bump the relevant cache-key version to avoid reusing incompatible cached data. If scope changes, update `PUBLISHERS.scope` and this guide.
6. Update the bound Apps Script files and deploy a new version following [README.md](../README.md#update-the-deployed-app). Use **Refresh releases** or **Refresh catalog** to bypass the ordinary one-hour result reuse window; the current ISBN form has no cache-bypass option.

For HTTP 403/429, missing catalog tokens, or access changes, surface the feed error and verify the site's current public flow before changing the adapter. Increasing page counts or adding repeated retries is not a repair for changed markup or an unavailable source.
