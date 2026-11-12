# Administration

Only signed-in administrators can open `/admin` or call maintenance APIs.

Task details, cache previews, scraper reports, account management and confirmed
private-library inspections open in popups rather than below the page results.
Each popup keeps its heading and **Close** button visible while its contents
scroll. **Escape** also closes it and returns focus to the control that opened it;
account changes must finish before closing. Publisher task details preserve the
current crawl view.

## Library edit conflicts

Single-book and bulk-volume saves check only the rows being edited. Changes to
other rows do not block saving. If a row's revision changed without changing its
values, the editor retries automatically with the latest token.

When an edited row has changed, administrators see the original, latest saved and
draft values and choose which values to keep. Non-overlapping changes have safe
defaults; competing edits require an explicit choice. **Back to editing** preserves
the draft without saving. Bulk edits remain atomic, and every confirmed save checks
the latest tokens again so a newer edit cannot be overwritten unnoticed.

## Publisher cache warm-up

Open **Publisher crawls**, choose a publisher and mode, then confirm **Start crawl**.
Nothing schedules a new crawl automatically. Existing, explicitly started work
resumes from its durable checkpoint after an application restart.

- **All discoverable series** traverses the supported public series directory and warms its books.
- **New books** revisits series listings but skips books already processed by a crawl.
- **New series** visits only series not fully processed by a previous crawl.
- **Latest releases** uses the bounded release feed; this is the only mode for sources without a full-directory adapter.

Publisher adapters have pagination/availability limits. Incomplete series are
reported and remain eligible for a later new-series crawl. Completion means the
discoverable frontier was processed, not a guarantee that an inaccessible or
unlisted book exists in the cache.

There is at most one background crawl across app instances. Requests are
serialized and separated by at least ten seconds (or a larger robots.txt delay).
robots.txt exclusions are respected. Source errors back off for at least fifteen
minutes; HTTP Retry-After can extend that delay. Cooldowns survive restarts.
Every network boundary checks for waiting/running foreground work, queue pause,
crawl pause/cancellation and administrator revocation. In-flight requests finish
safely, while a worker slot remains available for user lookups.

Pause/resume/cancel individual crawls in this tab. Cancelling never deletes shared
cached metadata. Warm-up caches public metadata only, without downloading covers
or editing anyone's library.

## Scraper debugger

Open **Scraper debugger**, enter an ISBN, select a provider and choose **Run fresh
scrape**. The administrator-only task uses the normal scraper and safe HTTP
transport, but starts with an empty, run-local success cache. Existing retry
cooldowns remain enforced; failures also update those cooldowns. Successful
diagnostics do not replace shared metadata or modify any library.

The report includes each request URL, method, HTTP status, safe response headers, content type, timing,
raw response body, intermediate parser snapshots, final parsed result and error
stack. HTML and scripts are displayed as escaped text, never executed. Request
credentials and response cookie headers are not recorded. **Download debug
report** exports the captured data as JSON. Captured response text is bounded to
32 Mi characters per run, with explicit truncation notices; the normal 8 MiB
per-response transport limit still applies. No cover downloads are performed.

Runs use the durable scraping queue and its concurrency/pause controls. Long-running
or paused runs remain inspectable under **Scraping queue**, including after a
restart. Only applicable ISBN providers can be selected; no arbitrary fetch URLs
or executable code are accepted.

## Users and re-linking

**Users** searches account names, email addresses and IDs, displays safe account
details and counts, provisions accounts, renames accounts, changes roles,
disables/enables access and revokes sessions. An administrator cannot disable or
demote their own account. Access changes are audited. Disabling preserves data.

Private libraries are not loaded with account details. **View library** asks for
confirmation before making any library request. Inspection is read-only,
paginated, searchable and audited, with books (including removed ones), saved
releases and linked catalogs. System-record inspection also confirms before
loading private library categories.

To move a library to another Google account, supply the destination Gmail or
Google Workspace email and choose **Generate re-link URL**. Copy the invitation
and send it privately to the user; the app does not send email. Links expire in
24 hours, are single-use, and replace any older invitation for the account. Only
their hashes are stored. The URL fragment keeps the secret out of request URLs
and referrers; the recipient confirms before submitting it by POST into the
browser-bound, PKCE/nonce-protected Google sign-in flow.

The destination email must match the verified Google identity. Re-linking keeps
the same internal account ID and all its data/preferences, revokes all previous
sessions, and cannot merge with another existing library. Issuing or opening a
link does not revoke the original user's access; only successful redemption does.
Use **Revoke invitations** to invalidate an unredeemed link.

## Searching scraped data

**Metadata & caches** searches inside cached JSON and source responses as well as
keys: use a title, ISBN, URL or a fragment of response text. Category and expiry
filters work alongside the search. Filtering and pagination happen in PostgreSQL,
so browsing does not load every raw response into server memory.

**Inspect** opens a popup with parsed data or readable raw source text, positioned near the
search match. Large responses have previous/next text controls instead of an
inaccessible truncated tail. HTML is shown only as escaped text, never executed.
Inspection and search do not fetch publisher pages, images or modify libraries.
Account-scoped caches are excluded by default; including them requires explicit
confirmation. Credentials, OAuth handshakes and session secrets are not part of
the inspectable cache table.
