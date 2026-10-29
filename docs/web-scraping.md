# Publisher catalogs and metadata

The Next.js server fetches publisher pages using native `fetch`. `lib/server/catalogs.ts` coordinates library lookups, stored covers, catalog annotations and stale-result fallback. Source-specific requests live in `lib/server/scrapers/`, with one module per publisher or metadata provider. `registry.ts` registers the active sources and their capabilities; `http.ts` shares bounded requests, redirect checks and page/API caching. `lib/server/scrape-cache.ts` owns durable SQLite response reuse and retry cooldowns. Pure parsers and URL validation remain in `lib/domain/`; Yaakz’s serialized product decoder and shared gallery parser remain in `lib/server/yaakz.ts` and `lib/server/publisher-covers.ts`.

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

Explicit `refresh: true` bypasses fresh catalog and page/API entries. Failed requests impose a durable 15-minute cooldown on that resource, including explicit refreshes, so repeated views or restarts cannot hammer an unavailable source. Failed cover downloads use the same durable cooldown per image URL, so loading cached listings does not repeatedly wait on unavailable images. Stored images remain available during a cooldown. HTTP errors and invalid JSON are not cached as successful responses. Failed catalog refreshes keep previous records and their original check time with a stale warning. Saved releases and explicit series links are independent database records, so cache expiry does not remove them. SQLite owns this cache; outgoing `fetch` still uses `no-store` to avoid an additional framework cache overriding refresh behavior.

## Publisher ISBN search

`searchPublisherIsbn({ publisherId, isbn, refresh })` supports DEXpress, Animag, Phoenix Next and First Page Pro independently of loaded discovery categories and recent releases. ISBN-10, ISBN-13, prefixes and hyphens share a canonical ISBN-13 cache entry for 24 hours. Requests use the same source allowlists, retry cooldown and stored-cover service as other catalog features.

Phoenix requests `/catalogsearch/result/?q=<isbn>`, then checks at most four product candidates. `lib/domain/phoenix.ts` requires the main product’s labeled Barcode/ISBN attribute or `book:isbn` metadata to match; preview and recommendation links cannot confirm the ISBN. First Page Pro requests `/search?q=<isbn>` and returns up to 24 search candidates with blank ISBN fields and a review note, because product details omit ISBNs. The browser carries the user’s search ISBN into the add form explicitly as unconfirmed input. A First Page Pro search result never becomes an automatic exact-ISBN ownership match. Confirmed empty searches are cached; unavailable sources and unrecognized result markup remain errors.

Animag also supports full-catalog ISBN search through `/search?q=<isbn>`, independently of release feeds and loaded discovery categories. It checks up to four regular product candidates against the main product’s JSON-LD ISBN/GTIN/SKU, matched by canonical product URL. A search hit or recommendation cannot confirm another product’s ISBN. Animag participates in automatic barcode lookup before generic metadata providers; confirmed empty searches and verified matches share the existing durable cache and retry policy.

## Lily House

[Lily House](https://lily-house.com/) supports releases, title discovery, series and missing-volume checks, saved listings, publisher ISBN search and cover galleries. Both server and browser matching recognize Lily House, Lilly House and ลิลลี่เฮ้าส์.

- Releases read `/shop-2/?orderby=date` and `/shop-2/page/2/?orderby=date`, keeping at most 48 shop listings after excluding merchandise. These are recent catalog listings, including preorders, rather than publication dates.
- Discovery presets browse all titles, manga, novels or English books. WooCommerce product categories identify format and language; the application stores prose novels under its existing `LN` type. Manga, Thai novels and English editions remain separate during discovery and ownership matching.
- Series checks use `/?s=<title>&post_type=product`; unrelated search hits remain marked for review. The search title can be changed explicitly. Catalogs follow `/page/N/` navigation on the same source for at most 20 pages. The inspected theme omits result totals, so completeness requires valid cards, new listings on every page and the final pagination page, or a valid single-page result. Repeated pages, malformed cards, failed requests, inconsistent counts and bounded traversals remain incomplete. Incomplete refreshes preserve previously complete series results.
- Cards supply listed baht prices, covers and stock/backorder labels. Preorder and `(COMIC)` prefixes and English edition labels are removed from series names; explicit and trailing volume numbers are recognized. Unstated volumes remain blank. Sets, sprayed-edge editions and selectable parents require review. Parent products cannot establish ownership of an individual volume.
- Publisher ISBN search uses the same full-site search with canonical ISBN-13. The inspected pages expose shop SKU codes rather than ISBNs, so search candidates retain blank ISBNs and a review warning. They cannot become automatic barcode metadata or exact ownership matches. The add form carries the searched ISBN explicitly for review, as it does for First Page Pro. Confirmed empty searches and unverified results share the normal durable cache; failures remain errors.
- Product URLs accept only HTTPS product paths under `/shop-2/` on `lily-house.com`. Redirects may normalize a trailing slash while retaining the same host, path and query. Cover galleries require the main product's matching structured URL and use its original image and gallery images, excluding badge overlays and recommendations. Images accept only the site's `/wp-content/uploads/` path and use permanent stored-cover storage. Series matches also supply automatic covers without an ISBN.

Trimmed live fixtures were captured on October 25, 2026. They cover Thai manga and novels, English books, numbered volumes, preorders, sets, gallery overlays, and the site's explicit empty-search message. Large category checks can stop before the full catalog; their completeness is reported accordingly.

## Animag

[Animag Shop](https://www.animagshop.com/) is integrated with releases, title discovery, full series catalogs, missing-volume checks, saved releases, automatic ISBN metadata, cover galleries, and seasonal anime discovery. Publisher aliases include A-Plus, G-Plus, Animag Books, Animag Comics, and BeLOVED+ in both server validation and browser ownership matching.

- Releases read `/category?sortby=new` and `&tskp=2`, deduplicating up to 100 listings. This is a recent catalog window; shipping notices are not publication dates.
- The advanced-search page `/search` exposes the complete `category_id` directory. Its indented series options inherit the format of the five book imprints. Discovery can browse all titles or one imprint, and keeps manga and novel categories separate. Non-book service and promotional roots are excluded.
- Series links accept only `https://www.animagshop.com/category/<id>`, optionally with descriptive slugs that are canonicalized away. Series pages use `?tskp=N`, up to 20 pages. Only the product pagination’s explicit total counts toward completeness; subcategory pagination does not. Repeated pages, missing counts, partial traversals, and outages remain incomplete. Failed or incomplete refreshes preserve a previously complete series result and its original check time.
- Listing cards supply titles, discounted `product_price` values, SKU codes where shown, and availability. Matching `CollectionPage` JSON-LD products supply original cover images and ISBN-shaped SKUs, validated by checksum. Arbitrary shop codes remain blank ISBNs. `Animag`, preorder prefixes, `NOVEL`/`COMIC`, and shipping notices are removed from parsed series names; decimal volumes and single-volume `เล่มเดียวจบ` books are recognized. Bundles and limited editions retain their review flags and cannot borrow a regular volume’s ISBN.
- Selectable products expand from their product-page JSON-LD into individual variants. Each retains its own ISBN, price, stock status, cover, and `?pid=<variant-id>` link. Completeness counts the parent listings, so expansion cannot inflate coverage. Bundled variants remain marked for review; parent images and ISBNs are never copied to the variants.
- Product links canonicalize to `/product/<id>`, preserving only an optional numeric `pid` variant parameter. Safe redirects may add a slug while preserving the same product/category ID and host. Cover galleries use only that main product’s structured images, excluding recommendation images. Images use the existing allowlisted `lnwfile.com` hosts and permanent stored-cover service.

Trimmed live fixtures were captured on October 24, 2026. At inspection, the search directory contained 212 book categories, and the Re:ZERO category exposed 39 listings, including box sets and side stories. These are current listings, not a guarantee that removed or out-of-print books remain available.

## DEXpress

[DEXpress](https://www.dexpress-shop.com/) supports recent releases, discovery, series and missing-volume checks, saved listings, exact ISBN lookup, and cover galleries. Both server and browser matching recognize DEXpress, DEX and Thai publisher aliases.

- Releases read `/showroom/new` and `?tskp=2`, deduplicating up to 60 catalog listings. Cards supply titles, sale prices, availability and cover thumbnails. Unlabeled regular books use their product details to resolve the format; unavailable details leave the listing for review. These are recent listings, not publication dates.
- Discovery browses the complete manga category `/category/2`, novel category `/category/3`, or both through the all-titles preset. Each category traverses up to 20 pages. The explicit product total must equal the number of unique listings before a result is complete. Manga and novel discovery cards remain separate, including when one format is already owned.
- DEXpress has format categories rather than series categories. Series checks search `/search?q=<title>` separately with `category_id=2` and `category_id=3`, following `&tskp=N` pagination. Related stories remain flagged for review. Empty searches ask for the publisher's title; incomplete or failed refreshes preserve a previously complete result and its check time. Explicit links accept HTTPS numeric categories or a search URL with one nonempty `q` parameter.
- Product URLs canonicalize to `/product/<id>`, preserving an optional numeric `pid`. Autograph time-slot variants retain distinct links but have no guessed volume or format. Autograph sets and multi-volume packs cannot identify a regular owned volume. `[DEXPRESS]` and format labels are removed from parsed series names; `Lv.5`, decimal volumes and explicit single-volume labels are recognized.
- Exact ISBN search checks up to four regular product candidates. `lib/domain/dexpress.ts` parses the storefront's JSON `payload.pdata` literal without executing scripts, and requires its product ID and full URL to match the candidate. Only that product's checksum-valid `barcode` or `isbn` confirms a match. Shop SKU codes, recommendations, bundles and selectable parent products cannot confirm an ISBN. A failed candidate does not hide a later verified book. Confirmed misses use the 24-hour cache; failures use the shared 15-minute cooldown and allow other metadata providers to continue.
- Product galleries read only the matched main product's `images`. Images use the existing `lnwfile.com` allowlist and permanent cover storage. Series catalogs can supply automatic covers without an ISBN. ISBN and cover-miss cache versions were advanced so earlier misses do not hide the new provider.

Trimmed live fixtures were captured on October 25, 2026. The inspected series search contained 57 listings across both formats, including related stories and autograph variants; the manga results required a second page. The fixture tests cover pagination, format separation, edition review, exact barcodes, redirects, caching and outages.

## Dedicated series catalogs

Opening a series immediately renders gaps from the recorded shelf and calls `getSeriesCatalog({ series, publisherId, type, refresh })` for each supported publisher/type owned in that series. It does not call the recent-release feeds. Returning to a series reuses its loaded result. **Refresh catalog** reloads the shelf first, then bypasses catalog reuse and refreshes the category directory when finding an automatic match. Each response is stored under the requesting series and edition, so navigation during a fetch cannot show another series' result.

| Publisher      | Category discovery                                                              | Full-series source                                    | Pagination                                                                     |
| -------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| Phoenix Next   | Anchors in [the series directory](https://www.phoenixnext.com/book-series.html) | `/book-series/<slug>.html`                            | `?p=N`, at most 20 pages                                                       |
| First Page Pro | Category anchors in [the site navigation](https://www.firstpagepro.com/)        | `/category/<numeric-id>`                              | `?tskp=N`, at most 20 pages                                                    |
| Luckpim        | Full title search; its categories group formats and genres                      | `/get/search_pin/key?page=1&limit=-1&keyword=<title>` | The site's full search response, without the suggestions-only `take` parameter |
| DEXpress       | Format-filtered public title search                                             | `/search?q=<title>&category_id=2` and `category_id=3` | `&tskp=N`, at most 20 pages per format                                         |
| Yen Press      | Paginated public series search index                                            | `/series/<slug>`                                      | Print-only `/series/get_more/<same-slug>` continuations, at most 20 pages      |

`parseSeriesCategories()` extracts category titles and allowed URLs. `matchSeriesCategory()` requires one exact normalized title or English slug match. A unique category ending with an explicit volume label such as `เล่ม 01` can also match the series without that suffix; numbers within series names are preserved. The same suffix rule applies when checking whether a linked category's listings are variants. First Page Pro's manga/light-novel URL prefixes identify the category format and disambiguate same-name categories. Normalization ignores punctuation, spacing, supported leading format labels and `@COMIC`; type is compared separately. It does not guess translations or choose a fuzzy match.

When no unique category matches, the response has `needsSelection: true`, category choices and `complete: false`. **Choose series category** searches these titles and URLs locally, or accepts a pasted URL. `setSeriesCatalog()` validates the publisher host/path and saves the explicit choice keyed by normalized shelf title, publisher ID and exact book type. Phoenix URLs must be HTTPS series-category paths; First Page Pro URLs are canonicalized to the numeric category root. Luckpim choices accept only its HTTPS `/search_result?k=<title>` URL. Arbitrary fetch URLs are rejected.

The `catalog()` method in `lib/server/scrapers/html-catalog.ts` reuses the product-card parser described below. It reads Phoenix's `span.toolbar-number` or First Page Pro's `span.tsk-all` count, deduplicates product IDs, and requests more pages until the total is accounted for or the bounded traversal stops. `complete` is true only when unique extracted listings equal the reported total. Missing counts, repeated pages, extraction mismatches and the 20-page limit stay incomplete. An empty page without an explicit zero total is a failure. The category heading, falling back to the HTML title, supplies the publisher's series title. Live samples included 32 Phoenix listings for [ดอกรักผลิบานที่กลางใจ](https://www.phoenixnext.com/book-series/kaoru-hana-wa-rin-to-saku.html) and 11 First Page Pro listings for [ชิชุนกิจัง](https://www.firstpagepro.com/category/56), including older volumes.

`fetchLuckpimSeries_()` gets a fresh public token/cookie session from Luckpim's home page, then reads the full search endpoint. It requires HTTP 200, `status === 200`, an array in `data.list`, and a non-negative integer `data.total`. Extracted records must equal that total for a complete result. The shared Luckpim item parser supplies type, listed price and stock/pre-order labels. An empty search asks for the publisher's series title. It never substitutes the monthly new-release feed.

Catalog records retain `catalogSeries`, the local shelf title, so explicitly linked aliases compare and save under that title. A parsed title differing from both the category title and local title is marked `catalogVariant` for review. The browser groups normal unmatched volumes by publisher, exact type and volume, preserving alternate product links within the same card. Special sets, unknown/other editions, missing volume numbers and possible owned copies stay under **Check the edition**. These rules use the currently listed category, not a claim about every volume ever published; removed and out-of-print listings can be absent.

## Publisher sources and extraction

| Publisher ID | Source                                                                                           | Pagination                                            | Maximum scope per check          |
| ------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------- |
| `phoenix`    | [Phoenix Next new releases](https://www.phoenixnext.com/new-release.html)                        | First page, then `?p=2`                               | Two pages, capped at 72 listings |
| `firstpage`  | [First Page Pro new arrivals](https://www.firstpagepro.com/showroom/new)                         | First page, then `?tskp=2`                            | Two pages, capped at 40 listings |
| `luckpim`    | [Luckpim monthly new releases](https://www.luckpim.com/product/list/new) and its catalog request | `page=1` and, when needed, `page=2`, with `limit=100` | Up to 200 listings               |
| `dexpress`   | [DEXpress new arrivals](https://www.dexpress-shop.com/showroom/new)                              | First page, then `?tskp=2`                            | Two pages, capped at 60 listings |

These limits describe recent catalog listings. They do not provide a complete release history, and the lists can include pre-orders and special sets. `checkedAt` is the time the app successfully checked a feed, not a publication date.

### Phoenix Next

The shared HTML catalog’s `releases()` method downloads the two catalog pages. `parseCatalog('phoenix', html)` finds anchors whose class includes `product-item-link` and reads:

- The anchor text for the title and its `href` for the product URL.
- The first `data-price-amount` value in the associated card segment for the listed price.
- A 13-digit `isbnet` value in the card's BookWalker preview link, when present, for an ISBN candidate. The candidate must pass ISBN checksum validation.

The ISBN comes from the listing's preview link; the release fetch does not visit each Phoenix product page to verify its barcode. A sample preview-link ISBN was compared with the publisher's product-page barcode during the October 9 inspection. This relationship must be checked again if the site changes. Special sets discard this ISBN candidate so a regular volume's preview ISBN does not identify the entire set as owned.

Phoenix availability and release dates are left blank by this scraper. A missing price or ISBN remains blank; the scraper does not infer those values from the product slug.

### First Page Pro

`parseCatalog('firstpage', html)` splits the page at `div` elements with both `productArea` and `productItem` classes. Within each card, it reads the `gadgetThumbnail` anchor's `title` and `href`. The price comes from the anchor's HTML-encoded `GAEEPD` JSON attribute, specifically its `price` field.

Product URLs are reduced to `https://www.firstpagepro.com/product/<numeric-id>`. Removing the descriptive slug gives the same book a stable URL if its title spelling changes. The short URL was checked during the live inspection.

The First Page Pro listing scraper does not extract an ISBN, availability, or release date. Explicit leading publisher labels identify the format: `นิยาย` means `LN (TH)` and `การ์ตูน` means `Manga (TH)`. Pre-order and special-edition labels are removed before checking the format. These explicit labels take precedence over cached type hints and format words inside a series name. Discovery keeps same-name manga and novel categories separate. Older merged directories and incorrect catalog, ISBN-search and saved-release type hints are corrected when read; recorded owned-book details remain editable by the user.

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

`lib/domain/yenpress.ts` parses Yen Press's public search configuration, search records and book detail pages. `lookupYenPress_()` in `lib/server/scrapers/yenpress.ts` follows the site's public search flow:

1. Fetch `https://yenpress.com/search` and read the JSON `_elastic` configuration without executing page scripts. Require the known Yen Press search host and engine. The public search key is used only for that request and is not persisted.
2. POST the canonical ISBN to `https://enterprise-search.yenpress.com/api/as/v1/engines/yenpress/search`, with the site's public search key and origin headers. Request at most four results using the ISBN search field. Search can return fuzzy matches, so candidates must state the exact canonical ISBN and use a validated HTTPS `/titles/<isbn>-<slug>` URL on `yenpress.com`.
3. Fetch at most four unique candidate pages. Read the labeled ISBN inside the `book-details` section and accept only the matching `detail-info` block. Print and digital editions can share a page but have different ISBNs and imprints; neither retailer links nor the active tab confirm an edition.
4. Read the title, series, volume, author names (including “Original author”), imprint and release date. The book's own category breadcrumb identifies `LN (EN)` or `Manga (EN)`; digital pages use the genre category in their book details when the breadcrumb only says “Digital eBooks”. Read the lazy-loaded `series cover` image, allowing only supported image hosts, including `images.yenpress.com`; the site's generic Open Graph image is not a cover.

Successful results and confirmed misses are shared across ISBN lookup and **Pull covers** for 24 hours, including across restarts. Product HTML uses the existing seven-day cache. Failures use the 15-minute retry cooldown and do not stop Google Books or Open Library fallback. Automatic ISBN cover lookup uses the same verified details.

The saved comic, digital and novel fixtures in `tests/fixtures/publishers/yenpress-*` preserve representative page sections from [Solo Leveling, Vol. 1](https://yenpress.com/titles/9781975319434-solo-leveling-vol-1-comic) and [Omniscient Reader's Viewpoint (novel), Vol. 1](https://yenpress.com/titles/9798400903526-omniscient-reader-s-viewpoint-novel-vol-1). The search bootstrap fixture substitutes a test public key.

## Yen Press publisher catalogs

`yenpress` is a configured publisher for releases, discovery, saved listings, series comparisons and cover selection. Server and browser matching recognize Yen Press, Yen On, Ize Press and JY as this catalog source. `lib/domain/yenpress-catalogs.ts` parses the public records; `lib/server/scrapers/yenpress.ts` handles source requests through the shared HTTP and cache services.

- **Discovery and category choices:** query the public search index with `type: series`, excluding the Yen Audio imprint. Read up to 20 pages of 1,000 records, requiring stable totals, matching page numbers and unique record IDs. Deduplicate series URLs after accounting for every raw record. The directory supplies validated HTTPS series links and format hints from explicit title labels or the Yen On/Ize Press imprint. Formats without a confirmed hint are resolved from the series page as their cards approach the viewport. Manga/comics and novels remain separate discovery cards. A confirmed empty series is hidden; failed checks remain visible. Directory responses are reused for seven days and shared with automatic category matching.
- **Series catalogs:** accept only HTTPS `/series/<slug>` URLs on `yenpress.com`. Read the heading, its numbered-volume count, the category breadcrumb, and product links/images inside `#volumes-list`. Older volumes use the page’s `show-more` link. Continuation URLs must remain on the same series, contain a numeric `next_ord`, and use only Paperback/Hardback format parameters. Requests send the site’s AJAX header. Deduplicate products across at most 20 pages; repeated pages, missing counts and failed continuation requests stay incomplete. The heading counts numbered volumes, so unnumbered collector editions remain extra listings for review. A partial refresh retains an earlier complete catalog and its check time. Successful catalogs are reused for 24 hours.
- **Current releases:** read the current month from [the release calendar](https://yenpress.com/calendar). Keep at most 200 novel, manga and comic candidates, excluding chapter and audio listings. Confirm the candidate ISBNs in one public-index query restricted to `books-light-novels`, `books-manga` and `books-comics`; digital-only records are excluded. Require a complete response and use only validated book URLs. Read each cover and release date from its own calendar card. Prices stay blank rather than treating US/Canadian prices as baht. Release responses use the six-hour cache and retain previous successful listings during an outage.
- **Covers:** matched series volumes supply automatic covers even without a saved ISBN. The cover picker confirms the selected product’s ISBN, or its volume and format when no ISBN is recorded. Covers use the existing validated image storage and backup behavior.

Fixtures include a 15-volume comic series, a longer novel series with a collector edition and continuation page, paginated directory records, and a release calendar containing print, digital-only, chapter and audio examples. They cover source changes, unsafe links, incomplete pagination, offline reuse, publisher aliases and the publisher UI.

## Japanese covers from Hanmoto

[Hanmoto](https://www.hanmoto.com/) supplies exact-ISBN metadata and cover choices for Japanese books, including Kodansha manga. Requests use `/bd/isbn/<isbn>` for canonical ISBNs beginning with `9784`; missing ISBNs and other language groups require no request. The source is registered for automatic ISBN cover lookup and **Pull covers**, after Kinokuniya and before Google Books in metadata preference. It does not require an API key.

The parser verifies both the page's `books:isbn` metadata and its main book's ISBN field. Titles omit ruby pronunciation readings. Cover images must come from `img.hanmoto.com/bd/img/` and their filename must match the requested ISBN; placeholders, logos and other volumes' images are excluded. Source links identify the Hanmoto page while retaining the book's saved publisher link. Images use permanent SQLite storage and normal backup behavior.

Parsed results and confirmed 404s are reused for 24 hours across ISBN lookup and cover choices. Refresh bypasses fresh data; failures retain the durable 15-minute retry cooldown and allow other metadata providers to supply a result. Lookup and cover-miss cache versions were advanced so earlier misses do not suppress the new source.

Trimmed live fixtures cover Domestic na Kanojo volumes 1 and 28. On October 30, 2026, all 26 ISBN-bearing volumes in the supplied series export returned matching Hanmoto book pages and downloadable JPEG covers. Volumes 20 and 21 had no ISBN and were left unchanged.

## Ownership and covers

`lib/client/matching.ts` contains the shelf-gap, release-ownership and discovery rules. ISBN matches use canonical ISBN-13 values. Series matching keeps publisher, language and format separate, while colored and regular manga share volume coverage. A single-volume special edition can satisfy its regular volume; multi-volume sets require review. Saved catalog aliases retain the mapping between a shelf title and the publisher’s name.

Cover discovery runs on the server. `lib/server/covers.ts` validates image bytes and stores them permanently in SQLite under content-based IDs. The browser requests `/api/covers/<id>`; it does not fetch publisher images directly. See `tests/integration/covers.test.mjs` for size bounds, redirects, persistence, backups and failed-source behavior.

## Maintaining a publisher

The scraper boundary is defined in `lib/server/scrapers/types.ts`. Each `ScraperDefinition` declares its ID, exact allowed hosts, optional redirect identity and a `create(context)` factory. Factories receive shared `fetchText`, `fetchJson`, `requestRemote` and cache helpers. Use those helpers instead of calling `fetch` directly so timeouts, size bounds, refreshes and retry cooldowns apply consistently. Session-bearing handshakes use `requestRemote`; cache their public parsed results rather than tokens or cookies.

Implement only the capabilities the source supports:

| Capability                                        | Purpose                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `releases`                                        | Recent publisher listings                                                           |
| `catalog`                                         | A full category or series catalog, including completeness and page counts           |
| `directory`, `seriesDirectory`, `searchSeriesUrl` | Discover titles, choose series categories, or search by series name                 |
| `searchIsbn`                                      | Publisher ISBN search, including unverified candidates and review warnings          |
| `lookupIsbn`                                      | Verified barcode metadata; `isbnPriority` sets provider preference                  |
| `gallery`, `coverOptions`                         | Product galleries and supplementary cover sources; `coverPriority` sets their order |

`createHtmlCatalog()` shares bounded listing pagination; each source supplies its page parameter, release limit and optional variant expansion. `createIsbnSearch()` shares search caching and malformed-result checks while the source verifies candidate products. Source options also preserve parser-specific series names, complete catalogs and cached-directory upgrades where needed. Shared code must not infer these capabilities from publisher IDs.

To add a source:

1. Save a minimal representative response under `tests/fixtures/publishers/` or `tests/fixtures/series-catalogs/`.
2. Add a source module under `lib/server/scrapers/`, using a nearby source as an example. Keep pure parsing and URL validation in `lib/domain/`.
3. Import the definition and add it to `SCRAPER_SOURCES` in `registry.ts`. Host permissions, ISBN lookup and cover capabilities are registered together. Set `isbnPriority`/`isbnWarning` or `coverPriority`/`coverWarning` when providing those features.
4. For a publisher exposed in the app, add its display metadata to browser-safe `PUBLISHERS` in `lib/domain/constants.ts`. Add publisher aliases, allowed product/category/image URLs and title parsing rules in the relevant domain modules. Metadata-only providers do not need a `PUBLISHERS` entry. Never import the server registry into browser code.
5. Add fixture regressions for pagination, exact editions, incomplete responses and stale-cache fallback. `tests/integration/scraper-registry.test.mjs` also checks registration, removal, provider ordering and host restrictions.
6. Run `npm run check`. For publisher UI changes, also run `npm run build` and `npm run test:e2e`; browser scenarios use isolated temporary databases and fixed responses.

To stop using a source, remove its entry from `SCRAPER_SOURCES`. This removes its network host permissions and lookup/cover capabilities. Remove its `PUBLISHERS` entry as well to hide it from the app’s publisher choices. Keep historical publisher aliases and URL validators while stored books, saved releases or explicit series links still use them. Removing a scraper does not delete those records or stored cover images. Disposable cached lookup results retain their normal expiry.

To repair an existing source, edit its source module and focused domain parser, then extend the corresponding fixture test. Changes to a source’s requests do not require editing source-selection branches in the catalog service.

Fixture tests confirm the saved markup and application behavior. Live publisher markup can change; refresh a representative fixture when investigating a changed source.
