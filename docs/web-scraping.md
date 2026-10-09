# Web scraping: release feeds and ISBN lookup

The deployed app reads public publisher catalogs to build the **New releases** view and reads Naiin book pages to look up an ISBN. This guide describes the current implementation, its data limits, and how to repair it when a site changes. The public pages and catalog requests were inspected on **October 9, 2026**. The selectors and endpoints below are dependencies of this implementation, rather than a guarantee of a stable API from the publishers.

## Where the scraping runs

All live website requests run in Google Apps Script through `UrlFetchApp` in [Code.gs](../apps-script/Code.gs). The browser calls Apps Script through `google.script.run` and receives ordinary data objects. It does not download or execute the publisher websites' JavaScript, and there is no headless browser or scraper server to install. The existing manifest already includes `script.external_request` permission.

[Index.html](../apps-script/Index.html) owns the release filters, shelf comparisons, and display. It renders scraped titles as text, rather than inserting the publishers' HTML into the app.

On the first visit to **New releases** in a page session, `loadReleases()` sends one `getPublisherReleases({ publisherId, refresh: false })` request per publisher concurrently. Pagination within each publisher request is sequential. Returning to the tab in the same session uses the already loaded results. **Refresh releases** reloads the shelf and then requests all three feeds with `refresh: true`. If the shelf cannot refresh, the app warns that ownership labels use the previously loaded collection.

There is no background schedule, email notification, or automatic crawl of every product page. Release search and filtering happen in the browser against the loaded data.

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

`splitBookTitle_()` decodes HTML entities and collapses whitespace. It recognizes markers such as `(LN)`, `นิยาย`, `มังงะ`, `การ์ตูน`, and `@COMIC`, removes supported leading format/pre-order labels, and looks for a volume following `เล่ม`, `เล่มที่`, `vol`, or `volume`. It also accepts a trailing number, optionally followed by parenthesized text such as `(จบ)`. Decimal volumes such as `14.5` are preserved. These are title heuristics and can misread unusual names; they do not translate Thai and English series titles.

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
| Successful ISBN lookup | `isbn:v2:<canonical-isbn>` | Request six-hour retention; unsuccessful lookups are not cached |

Publisher caching is skipped unless `JSON.stringify(result).length * 3 < 95000`. This is a conservative size check. Cache retention is best effort, so a previous result is not guaranteed to remain available.

Each feed response contains `publisherId`, `items`, `checkedAt`, `stale`, and `error`. An HTTP failure, invalid Luckpim response, or a feed with no usable first-page listings produces an unavailable result. If a previous successful cached feed exists, it is returned with `stale: true`, its original `checkedAt`, and a refresh warning. Otherwise the result has no items or check time and an explanation. A second Phoenix/First Page Pro page with zero parsed listings ends pagination; an HTTP exception on that page fails that publisher's refresh.

The browser handles each publisher independently, so one failed feed does not hide successful feeds. A failed browser-to-Apps-Script request can also retain that publisher's previously loaded items in the current session. The code has bounded page counts and caching, but no additional HTTP retry loop, exponential backoff, custom fetch timeout, or per-host rate limiter.

The HTML readers use regular expressions tied to the current markup, rather than a general HTML parser. Partial extraction can succeed even if some cards stop matching. A plausible nonzero result therefore does not prove that all expected listings were captured.

## What is sent and stored

Release fetches send catalog URLs and, for Luckpim, the temporary catalog token/cookies. ISBN lookup sends the requested ISBN in a search/API URL and visits candidate product IDs. The app does not send the user's complete shelf, notes, spending, or scanned photographs to these publishers or metadata providers. Barcode/photo recognition runs in the browser; only the ISBN goes to metadata lookup.

Fetched HTML and catalog tokens are not persisted by the app. The cache contains normalized feed or lookup results. **Save for later** writes a normalized release snapshot to the hidden `_BookAppReleases` sheet with columns `Release ID`, `State`, `Book JSON`, and `Updated At`. Saved snapshots survive feed changes and cache eviction. `saved`/`unsaved` writes are keyed by the stable release ID, so repeating the same state does not create another saved entry. Saving a release does not write an owned book or purchase price.

## How scraped data determines “Not bought yet”

`releaseMatches()` in [Index.html](../apps-script/Index.html) compares each release against the loaded shelf:

- An equivalent checksum-valid ISBN gives **On your shelf · ISBN match**.
- A non-special release with a known volume can give **Volume on your shelf · Check the edition** when the normalized series and publisher match and the type matches whenever the release has a known type. Series normalization applies Unicode NFKC, lowercases, removes supported leading format labels, and ignores punctuation/spacing. Publisher aliases recognize Phoenix, First Page Pro, and Luckpim in supported English/Thai spellings.
- A release with neither match appears in **Not bought yet**. Possible edition matches are excluded from that default view and can be inspected using **Check edition**.

Missing shelf records/ISBNs, unknown types, title translations, unusual volume names, and special editions can affect these results. Catalog prices and “no match” labels are suggestions for review; buying or owning a book is recorded only when the user saves a book to the collection.

## Tests and maintenance

The reduced fixtures in [tests/fixtures/publishers](../tests/fixtures/publishers) preserve the markup/JSON needed by the adapters. Luckpim token/cookie test values are synthetic. [publishers.test.mjs](../tests/publishers.test.mjs) exercises extraction, publisher pagination parameters, deduplication, caching and stale feeds, public catalog headers, title parsing, URL validation, persistent saved records, and exact Naiin matching/fallbacks. Run it without network access:

```sh
node --test tests/publishers.test.mjs
```

[publishers.browser.mjs](../tests/publishers.browser.mjs) checks filters and ownership labels, saved records across refresh/reload, add-form review, partial feed failures, Naiin form filling, text rendering, and phone/desktop layout against the local preview. Start the preview separately and use the browser environment settings documented in [README.md](../README.md#local-development):

```sh
node preview/server.mjs
node tests/publishers.browser.mjs
```

The preview serves fixed examples from [preview/releases.json](../preview/releases.json) and a Naiin fixture for ISBN `9786166247275`. It does not scrape the live publishers. The test harness also simulates `UrlFetchApp` and cache storage; it does not test real Apps Script network access, cache expiration/eviction, or Google's deployed authorization. Passing these tests confirms behavior against the fixtures, not that today's live site still has the same markup.

When a feed stops working or seems incomplete:

1. Open the relevant source page and inspect the current response or the browser's catalog request. Check the card markup, next-page parameter, response fields, and token/cookie flow against the adapter above.
2. Capture small representative fixtures with Thai text, a normal volume, and a special/pre-order example where applicable. Replace any live token/cookies with synthetic test values; keep unrelated page scripts and descriptions out of fixtures.
3. Update the relevant function in `Code.gs`: `parseCatalog_()`/`fetchCatalog_()` for Phoenix or First Page Pro, `fetchLuckpim_()` for Luckpim, or `lookupNaiin_()`/`structuredBooks_()` for Naiin. Adjust `splitBookTitle_()` only when the title format itself changed.
4. Run the fixture tests, then inspect a fresh live result, including page 2 and sample product links. For Naiin, verify that an exact ISBN is accepted and a mismatched edition is rejected. Preserve the bounds and exact-ISBN checks when repairing a parser.
5. If the response schema changes, update the browser and saved-record handling as needed and bump the relevant cache-key version to avoid reusing incompatible cached data. If scope changes, update `PUBLISHERS.scope` and this guide.
6. Update the bound Apps Script files and deploy a new version following [README.md](../README.md#update-the-deployed-app). Use **Refresh releases** to bypass the ordinary one-hour feed reuse window; the current ISBN form has no cache-bypass option.

For HTTP 403/429, missing catalog tokens, or access changes, surface the feed error and verify the site's current public flow before changing the adapter. Increasing page counts or adding repeated retries is not a repair for changed markup or an unavailable source.
