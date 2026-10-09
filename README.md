# Book Collection

A Google Apps Script app connected to [your existing collection](https://docs.google.com/spreadsheets/d/1xtA2hqEGZPyvQS0ZC2NI30lJLJAugvFHPh9jQOyGhgg/edit).

Browse your collection grouped by series. Click a series to see **what you're missing** above **all your owned volumes**, sorted by volume number, and choose **Add volume** to add to that series. Add and edit books, search your shelf, update reading status, and scan ISBN barcodes. Removed books stay in **Recently removed**, where you can restore them. The app uses your existing columns and dropdown choices, including decimal volume numbers such as `14.5` and prices of `0` for gifts.

## Install in your Google Sheet

1. Open your collection while signed in to the Google account that owns it. Choose **Extensions → Apps Script**.
2. Replace the contents of **Code.gs** with [apps-script/Code.gs](apps-script/Code.gs).
3. Click **+ → HTML**, name the file **Index**, and paste [apps-script/Index.html](apps-script/Index.html).
4. Open **Project Settings** and enable **Show appsscript.json manifest file in editor**. Replace its contents with [apps-script/appsscript.json](apps-script/appsscript.json). This includes the Google Sheets API service. Alternatively, add **Google Sheets API** using **Services → +**. If the project uses a custom Google Cloud project, enable the Google Sheets API in that Cloud project too.
5. Save. Select **setupBookApp** in the function dropdown and click **Run**. Authorize the spreadsheet and external lookup permissions Google requests. This creates three hidden helper tabs for removed books and saved requests. It does not rewrite your existing books or summaries.
6. Choose **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Only myself**. Click **Deploy** and open the resulting `/exec` URL.
7. Bookmark that URL on your phone. Open it in Safari or Chrome, signed in to the same Google account. You can also reload your sheet and choose **Book Collection → Open collection** to use the desktop dialog.

The collection and sheet ID are already configured. You do not need an API key for the included lookup providers. Naiin is checked first and verifies the ISBN on the product page. Google Books and Open Library are fallbacks; Google Books can impose quotas. Missing metadata can always be entered manually.

The manifest grants spreadsheet access because the Sheets API is needed to preserve your native table and its formulas. Apps Script's Sheets scope is not limited to this one file, although this app's code targets only the configured spreadsheet. Keep the deployment set to **Only myself**: publishing an app that runs as you to everyone would let visitors use your spreadsheet permissions.

## Browse by series

The collection starts with one entry per series, showing its owned-volume count, book types and a preview of volume numbers. Multiple copies are shown with a count such as `1 ×2`. Search and type/status filters find series with a matching book. Clicking one clears those filters and opens **every owned volume** in that series, with no volume pagination. Decimal volumes sort correctly; unnumbered books appear last.

**What you're missing** appears at the top as soon as you open a series:

- **Shelf gaps** list missing whole-number volumes from 1 through the highest owned volume, separately for each type/language and publisher. Owning a Japanese volume, a light novel, or a color edition does not fill a gap in another edition. Duplicate copies do not change the gaps. Decimal and unnumbered books are retained on your shelf, but extra fractional volumes are never invented. Long missing runs are shown as ranges.
- Tap a gap to open **Add volume** with that edition's type, publisher and shop; a range opens its first missing volume. Saving refreshes the summary.
- **Recent releases you haven't bought** automatically checks the existing publisher feeds and shows matching unowned listings in this series. You can open the book page, save it for later, or review it in **Add to shelf**. Saved listings stay available after leaving the feed. ISBN-confirmed owned books are omitted; possible owned volumes appear under **Check the edition**.
- **Refresh releases** in the series reloads your shelf and publisher listings. Check times, preview samples and failures are shown here, including when an older successful feed is used after an outage. Opening another series uses the loaded feeds, and late results follow the series currently open.

Gap detection uses your recorded shelf, and release checks cover recent listings from Phoenix Next, First Page Pro and Luckpim. This is not a complete publication catalog: older releases, unsupported publishers, differently named series and unrecorded purchases can affect the results. **No gaps through volume N** describes only the owned-volume range; it does not claim the whole series is complete.

Choose **Add volume** inside a series, or select an existing title in **Add book**, to enter just the volume, reading status, price and date bought. The app reuses the type, publisher and shop from the most recently bought volume, filling missing shared details from older volumes of the same type and publisher. The inherited details appear above the short form; choose **Edit other details** to change them or add an ISBN or notes. ISBNs and notes start blank for each new volume. Choosing a different existing title updates the defaults; entering a new title brings back the full form and your previous manually entered defaults. Title matching ignores capitalization and surrounding spaces and saves the collection's existing spelling.

Choose **All series** to return to the main view. The summary cards in the main view show totals for your entire collection.

## Scan and add books

- Click **Add book → Scan**. Choose **Take photo** to use your phone's camera, **Choose photo** for an existing image, or **Live camera** for continuous scanning. Allow camera access when prompted. Scan the long ISBN barcode that starts with **978** or **979**; some Japanese books also have a second barcode that is not the ISBN.
- If live camera access is blocked by the browser or Google's embedded page, use **Take photo** or **Choose photo**. Include the whole barcode and any printed ISBN above it. Photo decoding happens on your device; images are not uploaded to a lookup provider or stored in your sheet. The app bounds photo resolution before decoding to reduce phone memory use and honors the photo's orientation.
- Some Thai editions have a shop barcode instead of an ISBN barcode. If no ISBN barcode is readable, the app tries reading the printed ISBN using local text recognition. Its first use downloads the text reader and English recognition data and can take a moment. Check the recognized digits against the cover, then choose **Use ISBN**. Only checksum-valid ISBNs are offered; the app does not substitute a shop code for an ISBN.
- A USB or Bluetooth barcode scanner also works: focus the **ISBN** field and scan. Scanners that send Enter will trigger the lookup. You can also type an ISBN-10 or ISBN-13 and click **Look up**.
- Lookup sends the ISBN to Naiin, then Google Books and Open Library if needed. Naiin results must match the ISBN on the book page; a search result alone is never accepted. Suggested series, volume and publisher fill empty fields. A Naiin search link is also available when no metadata is found. Existing typed fields are retained. Review the edition, series name, language/type and volume before saving, especially for Thai/Japanese manga and light novels.
- For a new title, choose the type and reading status, then enter any shop, sale price, date bought and notes. For an existing title, shared details are filled automatically and the form shows only volume, reading status, price and date bought. Enter **Sale price / amount paid** directly, or open **Calculate a discounted price** and fill in **Regular price** and **Discount**. Discounts can be **% off** or **Amount off**; calculated sale prices round to two decimal places. A sale price of `0` records a gift or a fully discounted book; leaving it blank records an unknown price. Click **Add book** or **Add volume** to write it to your sheet.
- Only the final sale price is stored in the existing **Price** column and used in spending totals. Regular price and discount are optional calculation inputs and start blank when you reopen a book. You can override the calculated sale price directly; changing the regular price or discount calculates it again. Discounts must be non-negative, percentages cannot exceed 100%, and an amount discount cannot exceed the regular price.
- Enable **Keep adding books** to retain type, publisher, shop, status and date bought for the next book. ISBN, volume, regular price, discount, sale price and notes start fresh. When an existing title is selected, **Keep adding volumes to this series** also retains that series name and its short form.
- If you own another copy with the same ISBN, select **Another copy**. Otherwise the app prevents an accidental duplicate, including equivalent ISBN-10 and ISBN-13 values.

## Track publisher releases and books you have not bought

Choose **New releases** to check [Phoenix Next](https://www.phoenixnext.com/new-release.html), [First Page Pro](https://www.firstpagepro.com/showroom/new) and [Luckpim](https://www.luckpim.com/product/list/new). **Not bought yet** is the default: it shows listings with no match in your recorded shelf. Each card shows the publisher, title, available volume/type/ISBN, listed price and a link to the publisher's book page. Books with an ISBN also offer **Find at Naiin**. Listed prices are in Thai baht; they are not recorded as purchase prices.

Use **All releases**, **For my series**, **On my shelf**, **Check edition** or **Saved for later**, and narrow by publisher or search. **All types**, **Light novels (LN)** and **Manga** filter formats across languages and color editions. **Hide special editions** hides marked special editions and sets; click it again to show them. These filters also apply to saved releases and stay selected when refreshing or switching tabs during the same visit. Listings with an unknown type appear under **All types**. The overview counts separate unmatched listings, ISBN-confirmed owned books and volumes that need an edition check:

- **On your shelf · ISBN match** compares equivalent ISBN-10/ISBN-13 values.
- **Volume on your shelf · Check the edition** means the normalized series name, volume, publisher and language/type match. It is kept out of **Not bought yet**, but still needs review. Different languages/types and special sets are not treated as the same edition.
- **Not bought yet · No shelf match** means the app did not find a match in the collection you recorded. Books you have not entered, missing ISBNs or different Thai/English series names can hide an owned copy. Use the collection or store checker to confirm uncertain books. **For my series** requires matching series names, publisher and type; it does not guess translations.

Choose **Save for later** to keep a release in your saved list even when it leaves the newest catalog pages. **Unsave** removes it from that list. Saving a release does not add an owned book or change spending totals. **Add to shelf** opens a review form with the series, volume and edition details; enter the actual amount paid and save after buying it. Special sets require checking the series/volume yourself. ISBN-confirmed owned releases offer **View owned series**.

Checks happen when you open this view and when you choose **Refresh releases**. Refresh also reloads your shelf for the purchase comparison. Successful feeds can be reused for one hour; the refresh button requests a fresh check. Each publisher shows its check time, and one unavailable publisher does not hide the others. A failed refresh uses the previous successful cached feed when available, marks it stale and keeps its original check time. Open the publisher link when a feed cannot be read.

The feed covers Phoenix Next's latest 72 catalog listings, First Page Pro's latest 40, and up to 200 listings from Luckpim's monthly new-release section. These are recent catalog listings, including pre-orders and special editions, rather than a complete publication archive. Dates/stock can change. No release date is invented from a listing or check time. This feature does not run scheduled checks or send notifications.

Replace both **Code.gs** and **Index.html**, then deploy a new version. The existing sheet columns and manifest stay the same. The app creates a hidden **_BookAppReleases** tab on your first saved release, so an existing installation does not need another setup run. Keep that tab to preserve your saved list.

The [web scraping implementation and maintenance guide](docs/web-scraping.md) documents each source, pagination and extraction rules, Luckpim's catalog token/cookies, Naiin's exact ISBN verification, caching, error handling, saved data, and how to update the scrapers when a site changes.

## Check a book in the store

Choose **Check a book → Scan barcode**. Use a live camera, a barcode photo, or a typed ISBN. **Already on your shelf** shows the matching series, volume, language/type and publisher, with a link to the series. The check reads your current sheet and compares equivalent ISBN-10 and ISBN-13 values. It does not add a book or call a metadata provider.

**No ISBN match** means that barcode was not found. If any owned books are missing valid ISBNs, the app explains that the check is incomplete. Use **Search owned series or volumes** to double-check your ownership by title and volume number. After scanning, books found by that search offer **Link this ISBN** when they lack an ISBN. Confirm the selected volume, language and edition, then save. Use **Scan next book** to check another barcode.

You need an internet connection for a current-sheet ISBN check. If that read fails, the app displays an error; it does not claim that you do not own the book. Manual search still uses the collection last loaded in this session.

## Add ISBNs to books you already own

Open a series and choose **Add ISBN** beside a volume that is missing one. Scan the barcode or type ISBN-10/ISBN-13, then click **Save ISBN**. The small form shows which series and volume you are updating. This changes only the ISBN cell and preserves the rest of the book record, including any formulas in other columns.

Enable **Continue with the next volume in this series missing an ISBN** to work through several owned volumes in order. Each barcode is reviewed and saved individually. Duplicate ISBN checks, checks for moved/edited rows, and safe retries apply here too. The store checker starts recognizing each volume as soon as its ISBN is saved.

When updating an existing deployment for these features, replace both **Code.gs** and **Index.html**, then deploy a new version using the steps below. The manifest and existing collection structure stay the same.

## Edit, remove and restore

Open a series and click the edit button beside a volume. Save changes, or click **Remove book** and confirm. Removed books disappear from the collection totals and are kept in **Recently removed** until restored. Restore returns the book's original values to the next available collection row. Removing or restoring a book does not delete or shift a whole sheet row.

The app verifies the book's current row and contents before editing/removing. If someone sorted or edited the sheet since the app loaded, refresh and reopen that book. Use the app for writes while saving: Apps Script's lock coordinates app requests, but cannot lock out a person manually editing the sheet at the same instant.

Rows containing formulas in the book columns must be edited in Google Sheets. This protects those formulas from being replaced with their displayed values.

## Existing sheet structure

The app expects **Sheet1**, with **Table1** starting at A1 and covering these ten columns:

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| ISBN | Series | Type | Publisher | Status | Volume | Source | Price | Date | Note |

New entries expand **Table1**, so formulas such as `SUM(Table1[Price])` and your **SpentBreakdown** queries include them. New publishers and shops are added to the table's existing dropdown choices. The app only writes book content in A:J and keeps summaries in M:N and **SpentBreakdown** intact. It fills genuinely empty book rows before extending the table.

**Collection spend** sums the prices in the sheet without assuming a currency. **Books on your shelf** counts book records; it can differ from your sheet's `COUNT(Table1[Price])` when a book has no price. Zero and blank prices are treated differently.

The hidden **_BookAppTrash** tab stores recoverable removals. **_BookAppOperations** stores successful request receipts so a retry after a connection failure does not add, remove or restore twice. The hidden **_BookAppReleases** tab keeps saved publisher listings. Keep these helper tabs; the app never automatically purges them.

## Update the deployed app

After changing the code, save and choose **Deploy → Manage deployments → Edit → Version: New version → Deploy**. The bookmarked app URL stays the same. Saving code alone does not update an existing production deployment.

For sale price and discount entry, replace **Index.html** and deploy a new version. The form saves the final amount paid into the existing Price column, so no spreadsheet or **Code.gs** changes are required.

For the shorter existing-title form, replace **Index.html** and deploy a new version. **Add volume** and choosing an existing title both reuse shared series details. No spreadsheet, manifest or **Code.gs** changes are required for this feature.

For the **What you're missing** series overview, replace **Index.html** and deploy a new version. It uses the existing collection and publisher-release backend; no spreadsheet, manifest or **Code.gs** changes are needed if publisher releases are already installed.

For the LN/manga and **Hide special editions** release filters, replace **Index.html** and deploy a new version.

For the October 9 camera/photo-scanning fix, replace **Index.html** and deploy a new version. No changes to **Code.gs**, the manifest, or your spreadsheet are needed. Live camera startup now requests the rear camera directly and plays video inline. Google or browser permissions can still block live camera access; the native **Take photo** button works independently. Closing the scanner stops camera tracks and cancels pending recognition; opening the iOS camera/photo picker does not discard a photo scan.

For the overlapping-filter save fix, replace **Code.gs** and deploy a new version. When a save or restore expands Table1 or adds a dropdown choice, the app removes any regular sheet filter overlapping the updated table range in the same atomic operation. This removes that filter's criteria and sorting settings. Table-backed filters and regular filters outside the table range are preserved. If saving fails, the filter and book data remain unchanged.

If an older deployment reports **Before converting your data into a table, please remove the filter that overlaps with the conversion area**, open **Sheet1** and choose **Data → Remove filter**, then retry. The conflict is with the regular sheet filter; removing it does not delete any books. For routine filtering of Table1, use its table controls.

## Verify after installation

Use a **copy of your spreadsheet** for the first live check. Change `spreadsheetId` in Code.gs to that copy's ID, and install the app in the copy's bound project. Ensure the copied table is still named Table1.

1. Add a disposable book with a blank ISBN, volume `14.5`, and price `0`. Confirm the values and date in A:J, and that the book is included in Table1.
2. Add another disposable book with a price and source. Confirm the total and SpentBreakdown update, including when the new row extends the bottom of the table.
3. Change the book's status, remove it, and restore it. Confirm the active price totals change appropriately and the summaries in M:N stay in place.
4. Test your phone's camera or photo scan with a real ISBN barcode, and review the lookup result before adding it.
5. Try the same ISBN again. Confirm it is blocked unless **Another copy** is selected.
6. Open a series and use **Add ISBN** on an existing disposable volume. Confirm only column A changes. Enable the next-volume option and confirm the next missing ISBN opens for review.
7. Use **Check a book** to scan that saved ISBN. Confirm it says **Already on your shelf** without adding a record. Try an unknown ISBN and confirm the warning about books still missing ISBNs, then search for an owned volume by series and number.

Local automated checks exercise validation, ISBN equivalence, current-sheet ownership checks, ISBN-only updates, concurrent/stale edits, atomic recoverable removals, request retries, table expansion, and preservation of adjacent summary cells. The local preview uses a copy of the exported collection, labeled sample publisher listings and a simulated backend; it cannot verify Google authorization, live Sheets API behavior, live formulas, or a physical phone camera.

Photo regression fixtures come from the three reported iPhone photos. All three original files and their bounded test copies were verified in Chromium at a phone-sized viewport:

| Photo | Expected ISBN | Recognition |
|---|---|---|
| IMG_2070 | 9786164894686 | ISBN barcode |
| IMG_2069 | 9786166247275 | ISBN barcode |
| IMG_2068 | 9786166147353 | Printed ISBN, reviewed before use; shop barcode is 3032504880045 |

The browser checks also exercise denied permission, inline camera playback, track cleanup, late permission results, unreadable images, and page backgrounding during native photo selection. These checks do not verify a physical iPhone camera or Google's deployed iframe permissions.

## Sources

- [Apps Script web apps and deployment](https://developers.google.com/apps-script/guides/web)
- [Apps Script client/server communication](https://developers.google.com/apps-script/guides/html/communication)
- [Google Sheets tables API](https://developers.google.com/workspace/sheets/api/guides/tables)
- [Atomic Sheets batch updates](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)
- [Google Books API](https://developers.google.com/books/docs/v1/using)
- [Open Library ISBN lookup](https://openlibrary.org/dev/docs/api/books)
- [Naiin ISBN search](https://www.naiin.com/search-result?title=9786166247275)
- [Phoenix Next new releases](https://www.phoenixnext.com/new-release.html)
- [First Page Pro new arrivals](https://www.firstpagepro.com/showroom/new)
- [Luckpim monthly new releases](https://www.luckpim.com/product/list/new)
- [ZXing WebAssembly barcode reader](https://github.com/Sec-ant/zxing-wasm)
- [Tesseract.js local text recognition](https://github.com/naptha/tesseract.js)

## Local development

No dependencies need installing. Run `node --test tests/*.test.mjs` for the Apps Script logic checks. Run `node preview/server.mjs` for a local preview at `http://localhost:8765`. Preview changes are stored only in the running preview's memory and never sent to your Google Sheet. The preview also includes a **Preview only** label; restart it to reset its data.

For photo and camera browser regression checks, start the preview, make Playwright available, and run `node tests/scan-photos.browser.mjs`. The script reads `tests/fixtures` by default. `BOOKS_SCAN_PHOTO_DIR` can point to the folder containing the original `IMG_2068.JPG`, `IMG_2069.JPG`, and `IMG_2070.JPG` files. Optional `BOOKS_PLAYWRIGHT_MODULE`, `BOOKS_BROWSER_EXECUTABLE`, and `BOOKS_PREVIEW_URL` select an existing browser runtime and preview. The tests need internet access to load the same pinned reader libraries used by the deployed app; no photos leave the device.

Run `node tests/pricing.browser.mjs` against the preview for sale-price checks. It verifies percent/amount discounts, two-decimal rounding, invalid discounts, direct sale-price overrides, blank versus zero prices, edit/save totals, resetting prices while keeping other book defaults, and phone/desktop layout. It accepts the same Playwright, browser and preview environment settings as the scanning checks and saves a phone screenshot to `outputs/pricing-preview.png`.

Run `node tests/series-entry.browser.mjs` against the preview for existing-title entry checks. It verifies the short form, recent-edition defaults, missing shared details, title switching, capitalization, saved inherited values, optional overrides, ISBN and notes handling, repeated volume entry, lookup suggestions, the full edit form and phone/desktop layout. It accepts the same environment settings and saves a phone screenshot to `outputs/series-entry-preview.png`.

Run `node tests/series-missing.browser.mjs` against the preview to verify immediate edition-specific gaps, duplicate/zero/decimal volumes, unnumbered books and large ranges, automatic releases, ownership and edition checks, navigation while feeds load, gap and release additions, saved-list actions, refresh failures and recovery, and phone/desktop layout. All RPCs use an isolated test collection, so this script never changes the running preview's data. It accepts the same browser environment settings and saves screenshots to `outputs/series-missing-phone.png` and `outputs/series-missing-desktop.png`.

Run `node tests/publishers.browser.mjs` against the preview to verify publisher/series filters, the default unbought list, ISBN-confirmed ownership versus edition checks, language/type matching, saved-list persistence across catalog changes and reloads, reviewed add forms, partial feed failures, Naiin metadata and phone/desktop layout. It accepts the same browser environment settings. The preview uses example feed data and a verified Naiin sample for ISBN `9786166247275`; it does not contact the live publishers. `tests/publishers.test.mjs` verifies publisher parsing, pagination, caching/outages, saved-list writes and exact ISBN lookup. Public live pages were inspected on October 9, 2026; their layouts and endpoints may change.

Run `node tests/release-filters.browser.mjs` to check LN/manga filtering across languages and color editions, unknown types, special-edition hiding, combined search/publisher/ownership filters, saved listings outside the current feed, filter retention during refresh/tab navigation, and narrow phone through desktop layouts. It uses an isolated test collection and accepts the same browser environment settings.
