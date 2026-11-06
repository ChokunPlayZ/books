# Accounts, privacy and shared metadata

Existing databases migrate in place: the existing collection belongs to the `admin` account, using `BOOKS_PASSWORD`. Back up the SQLite database before deploying a schema upgrade. There is no public registration.

To add another account on the server, set `BOOKS_NEW_USER_PASSWORD` to a password of at least 12 characters, then run `npm run user:add -- username`. Add `--admin` only for another trusted administrator. Unset the variable afterwards. New accounts start with empty collections. Accounts use independently salted scrypt password hashes and user-bound sessions. Once accounts exist, unauthenticated mode cannot bypass sign-in.

## Private to each user

- Owned copies, duplicates, and whether an ISBN is owned at all.
- Purchase source, price paid (including gifts), purchase date, and spending statistics.
- Reading/unsealing status, notes, edition labels, and personal metadata/cover overrides.
- Personal series names, merges, linked catalog choices, saved-for-later releases, and dropdown history.
- Removed books, removal history, restores, imports and import receipts, mutation retry receipts, and exports.
- Browser search/filter preferences are namespaced by user. Downloaded backup files remain the user's responsibility.

Every collection read and mutation, including bulk edits and image association, checks the authenticated owner. Even administrators use only their own library through the app; database/server administrators inherently have access to the underlying database.

## Shared public data

Independently scraped book metadata, ISBN/product URLs, MSRP and currency, public publisher/store images, and publisher feeds can be reused across accounts. A user's purchase source is never the scraper's metadata-source field. Saving or editing a book never publishes that user's data into the shared source cache.

Confirmed ISBN/source matches and their metadata are retained without expiry. Subsequent ISBN lookups, comparisons and cover requests reuse them, including after restarts. Prices and availability are snapshots, not live quotes; check their timestamps or open the shop. MSRP is distinct from selling price and price paid; missing MSRP remains blank rather than being inferred from a discount price.

Only administrators may request `refresh: true`, re-crawl metadata, inspect raw cache entries, or purge caches in **Data & backups**. Purging is an explicit administrative invalidation; future requests can fetch the removed source again. Failed refreshes retain successful data, with a retry cooldown. Unconfirmed misses still expire, so newly listed books can be discovered. Release feeds and category/directory pages still refresh on their normal schedule to discover new books; confirmed product pages do not.

Book type choices are **Manga**, **Light novel**, and **Others**. Legacy type strings are mapped on migration/import; their language/colour labels are retained in the private edition-details field.

After a production build, run `npm run test:multi-user` for the isolated multi-account browser smoke test. Like the main browser suite, it uses temporary databases and needs Playwright Chromium installed.
