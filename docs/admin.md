# Administration

Only signed-in administrators can open `/admin` or call maintenance APIs.

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

**Inspect** shows parsed data or readable raw source text, positioned near the
search match. Large responses have previous/next text controls instead of an
inaccessible truncated tail. HTML is shown only as escaped text, never executed.
Inspection and search do not fetch publisher pages, images or modify libraries.
Account-scoped caches are excluded by default; including them requires explicit
confirmation. Credentials, OAuth handshakes and session secrets are not part of
the inspectable cache table.
