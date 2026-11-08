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
