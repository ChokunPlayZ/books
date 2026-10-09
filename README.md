# Book Collection

A Google Apps Script app connected to [your existing collection](https://docs.google.com/spreadsheets/d/1xtA2hqEGZPyvQS0ZC2NI30lJLJAugvFHPh9jQOyGhgg/edit).

Browse your collection grouped by series. Click a series to see **all your owned volumes**, sorted by volume number, and choose **Add volume** to add to that series. Add and edit books, search your shelf, update reading status, and scan ISBN barcodes. Removed books stay in **Recently removed**, where you can restore them. The app uses your existing columns and dropdown choices, including decimal volume numbers such as `14.5` and prices of `0` for gifts.

## Install in your Google Sheet

1. Open your collection while signed in to the Google account that owns it. Choose **Extensions → Apps Script**.
2. Replace the contents of **Code.gs** with [apps-script/Code.gs](apps-script/Code.gs).
3. Click **+ → HTML**, name the file **Index**, and paste [apps-script/Index.html](apps-script/Index.html).
4. Open **Project Settings** and enable **Show appsscript.json manifest file in editor**. Replace its contents with [apps-script/appsscript.json](apps-script/appsscript.json). This includes the Google Sheets API service. Alternatively, add **Google Sheets API** using **Services → +**. If the project uses a custom Google Cloud project, enable the Google Sheets API in that Cloud project too.
5. Save. Select **setupBookApp** in the function dropdown and click **Run**. Authorize the spreadsheet and external lookup permissions Google requests. This creates two hidden helper tabs for removed books and saved requests. It does not rewrite your existing books or summaries.
6. Choose **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Only myself**. Click **Deploy** and open the resulting `/exec` URL.
7. Bookmark that URL on your phone. Open it in Safari or Chrome, signed in to the same Google account. You can also reload your sheet and choose **Book Collection → Open collection** to use the desktop dialog.

The collection and sheet ID are already configured. You do not need an API key for the included lookup providers. Google Books can impose quotas; Open Library is used as a fallback. Missing metadata can always be entered manually.

The manifest grants spreadsheet access because the Sheets API is needed to preserve your native table and its formulas. Apps Script's Sheets scope is not limited to this one file, although this app's code targets only the configured spreadsheet. Keep the deployment set to **Only myself**: publishing an app that runs as you to everyone would let visitors use your spreadsheet permissions.

## Browse by series

The collection starts with one entry per series, showing its owned-volume count, book types and a preview of volume numbers. Multiple copies are shown with a count such as `1 ×2`. Search and type/status filters find series with a matching book. Clicking one clears those filters and opens **every owned volume** in that series, with no volume pagination. Decimal volumes sort correctly; unnumbered books appear last.

Choose **Add volume** inside a series to prefill its name and, when consistent, its type and publisher. Choose **All series** to return to the main view. The summary cards in the main view show totals for your entire collection.

## Scan and add books

- Click **Add book → Scan → Start camera**. Allow camera access when prompted. Scan the long ISBN barcode that starts with **978** or **979**; some Japanese books also have a second barcode that is not the ISBN.
- If live camera access is blocked by the browser or Google's embedded page, choose **Take / choose a photo**. Use a sharp photo with the whole barcode visible. Photo decoding happens on your device; images are not uploaded to a lookup provider or stored in your sheet.
- A USB or Bluetooth barcode scanner also works: focus the **ISBN** field and scan. Scanners that send Enter will trigger the lookup. You can also type an ISBN-10 or ISBN-13 and click **Look up**.
- Lookup sends only the ISBN to Google Books and, if needed, Open Library. Their suggested title and publisher fill empty fields. Existing typed fields are retained. Review the edition, series name, language/type and volume before saving, especially for Thai/Japanese manga and light novels.
- Choose the type and reading status, then enter any shop, price, acquisition date and notes. Click **Add book** to write it to your sheet.
- Enable **Keep adding books** to retain type, publisher, shop, status and acquisition date for the next book. ISBN, volume, price and notes start fresh. When adding inside a series, **Keep adding volumes to this series** also retains that series name.
- If you own another copy with the same ISBN, select **Another copy**. Otherwise the app prevents an accidental duplicate, including equivalent ISBN-10 and ISBN-13 values.

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

The hidden **_BookAppTrash** tab stores recoverable removals. **_BookAppOperations** stores successful request receipts so a retry after a connection failure does not add, remove or restore twice. Keep both tabs; the app never automatically purges them.

## Update the deployed app

After changing the code, save and choose **Deploy → Manage deployments → Edit → Version: New version → Deploy**. The bookmarked app URL stays the same. Saving code alone does not update an existing production deployment.

## Verify after installation

Use a **copy of your spreadsheet** for the first live check. Change `spreadsheetId` in Code.gs to that copy's ID, and install the app in the copy's bound project. Ensure the copied table is still named Table1.

1. Add a disposable book with a blank ISBN, volume `14.5`, and price `0`. Confirm the values and date in A:J, and that the book is included in Table1.
2. Add another disposable book with a price and source. Confirm the total and SpentBreakdown update, including when the new row extends the bottom of the table.
3. Change the book's status, remove it, and restore it. Confirm the active price totals change appropriately and the summaries in M:N stay in place.
4. Test your phone's camera or photo scan with a real ISBN barcode, and review the lookup result before adding it.
5. Try the same ISBN again. Confirm it is blocked unless **Another copy** is selected.
6. Open a series and use **Add ISBN** on an existing disposable volume. Confirm only column A changes. Enable the next-volume option and confirm the next missing ISBN opens for review.
7. Use **Check a book** to scan that saved ISBN. Confirm it says **Already on your shelf** without adding a record. Try an unknown ISBN and confirm the warning about books still missing ISBNs, then search for an owned volume by series and number.

Local automated checks exercise validation, ISBN equivalence, current-sheet ownership checks, ISBN-only updates, concurrent/stale edits, atomic recoverable removals, request retries, table expansion, and preservation of adjacent summary cells. The local preview uses a copy of the exported collection and a simulated backend; it cannot verify Google authorization, live Sheets API behavior, live formulas, or a physical phone camera.

## Sources

- [Apps Script web apps and deployment](https://developers.google.com/apps-script/guides/web)
- [Apps Script client/server communication](https://developers.google.com/apps-script/guides/html/communication)
- [Google Sheets tables API](https://developers.google.com/workspace/sheets/api/guides/tables)
- [Atomic Sheets batch updates](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)
- [Google Books API](https://developers.google.com/books/docs/v1/using)
- [Open Library ISBN lookup](https://openlibrary.org/dev/docs/api/books)
- [html5-qrcode camera and photo scanning](https://scanapp.org/html5-qrcode-docs/docs/apis/classes/Html5Qrcode)

## Local development

No dependencies need installing. Run `node --test tests/*.test.mjs` for the Apps Script logic checks. Run `node preview/server.mjs` for a local preview at `http://localhost:8765`. Preview changes are stored only in the running preview's memory and never sent to your Google Sheet. The preview also includes a **Preview only** label; restart it to reset its data.
