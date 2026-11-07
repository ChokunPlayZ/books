# Security audit — 2026-11-06–07

## Scope and method

Repository-wide source review with separate subagent reviews of authentication and account isolation, uploads/imports and outbound requests, browser rendering and offline storage, and deployment/build configuration. Confirmed findings are fixed with regression tests. The starting worktree was clean.

The review covers Google OAuth and session handling, authorization and administrative operations, SQL and request boundaries, CSRF, stored/DOM XSS, URL validation, cover ownership, file/archive limits, SSRF, caching, container configuration, dependency provenance and accidental credential exposure.

The threat model includes unauthenticated requests, ordinary signed-in users supplying arbitrary API arguments or imports, hostile book metadata and publisher responses, and redirects or DNS records targeting internal services. Application/database administrators and a compromised host remain trusted boundaries; Google access revocation is not immediate application-session revocation.

This is a source review and local regression exercise, not an independent penetration test or a guarantee that the application has no vulnerabilities. No live production service or real Google account was tested or modified.

## Confirmed findings and fixes

Seven scoped findings were addressed: two high, four medium (including two conditional delivery/DNS findings), and one low. Residual risks and incomplete verification are called out explicitly below.

### High: renamed spreadsheets bypassed archive expansion validation

A signed-in user could rename a ZIP/XLSX file to `.csv`. SheetJS's format auto-detection still opened the binary workbook, but the XLSX-only validation path never ran, allowing a small compressed upload to trigger excessive expansion and process memory use.

`lib/server/importer.ts` now parses CSV as bounded text rather than passing it through binary auto-detection. Quoting, multiline notes, comma/semicolon/tab separators, Unicode and supported BOMs remain covered. Rows, columns and field lengths are bounded during parsing. XLSX files always pass archive validation; ambiguous prefixes and normalized-path/case aliases are rejected. Archive entries are not extracted to disk: no filesystem traversal exploit was found.

### High: malformed imports amplified bounded input into excessive allocations

A signed-in user could supply a large string as backup `options`; `Object.entries` allocated a pair for each character before validation. Multipart uploads could likewise contain enormous numbers of small fields, causing the native FormData parser to allocate excessive objects despite the overall byte limit.

The importer now checks the options container before enumeration. `lib/server/import-upload.ts` validates a single bounded boundary and preflights the number of multipart markers before invoking the native parser, then permits only one each of the expected file/action/fingerprint fields. `tests/integration/audit-io-import.test.mjs` covers these cases, renamed binaries, archive bounds and ordinary CSV/import compatibility.

### Medium: non-boolean refresh flags bypassed administrator authorization

Any ordinary signed-in user could submit values such as `refresh: "true"`, `1` or `{}` to catalog RPCs. The authorization wrapper compared the value to boolean `true`, while downstream adapters used truthiness. This allowed otherwise administrator-only forced outbound scraping and shared-cache refreshes. It did not grant administrator status or reveal another user's library.

`lib/server/api.ts` now rejects explicitly supplied non-boolean refresh flags before dispatch; boolean `true` still requires an administrator. `tests/integration/audit-auth-api.test.mjs` covers malformed flags across six operations, rejected requests making no outbound calls, normal cached reads and valid administrator refreshes. `audit-auth-isolation.test.mjs` additionally verifies database-backed session-role revalidation, Google credential-binding revocation, forged-role rejection, parameterized SQL-shaped strings, and cross-account write/export denial.

### Conditional medium: outbound DNS and AniList redirects could reach internal destinations

Hostname allowlists did not prevent permitted names resolving to private addresses, and AniList requests used unrestricted automatic redirects. Exploitation required influence over permitted DNS/provider responses; ordinary arbitrary URLs were already rejected. Existing TLS certificate verification was not disabled.

`lib/server/outbound.ts` now resolves inside the HTTPS socket lookup callback, rejects empty/mixed/private/special-use answers, and connects only to the validated addresses without connection reuse or implicit redirects. Existing publisher/cover host allowlists and redirect checks remain in place. AniList rejects redirects entirely. Literal IP destinations, credentials and non-HTTPS/non-default-port requests are refused. `audit-io-network.test.mjs` verifies DNS pinning and redirect-hop revalidation, IPv4/IPv6 transition ranges, decoded-body limits, cookies and compressed responses. Injected test transports are trusted dependencies, not user-selected bypasses.

### Medium: transfer and response handling had resource-exhaustion gaps

Stalled request bodies could retain transfer slots indefinitely; tiny chunks could cause excessive Buffer/string allocations. AniList JSON responses were unbounded. Concurrent or slow unread backup downloads could retain multiple complete serialized exports in memory.

`lib/server/http.ts` now coalesces chunks and applies body deadlines (30 seconds by default; 120 seconds for imports). Publisher/AniList decoded responses are capped at 8 MiB and covers at 5 MiB; compressed responses are checked after decompression, and rejected responses are cancelled. Backup downloads share the one-request process-wide large-transfer slot with imports, retain that slot until consumption/cancellation, have a 120-second body deadline, and are rate-limited to 20 requests per account per 15 minutes. `audit-io-backup.test.mjs` verifies account rate limits, transfer-slot retention/release and UTF-8 chunk boundaries.

**Remaining limitation:** an individual very large export still materializes database image data and JSON before transmission. Storage quotas or a fully streamed database export are still needed for stronger single-request memory guarantees. Concurrency pools are process-local, so multi-instance deployments also require infrastructure-wide budgets.

### Conditional medium: scanner entry scripts lacked integrity verification

If the CDN substituted the version-pinned barcode or OCR entry script, invoking scanning executed the replacement JavaScript with the application's browser privileges. Version pinning alone did not detect altered bytes. This requires control of the trusted delivery chain, not just an ordinary library account or malicious book metadata.

`lib/client/scanner.ts` now pins SHA-384 integrity values for both entry scripts, uses anonymous CORS, and omits referrers. The hashes were independently checked against the official npm archives. The browser regression substitutes executable attacker code and verifies it never runs; rejected downloads remain retryable. Genuine entry scripts were also checked with the pinned hashes.

This mitigates entry-script substitution, **not the entire scanner supply chain**: OCR worker/core/WASM and language-data downloads remain CDN-trusted. Self-hosting and auditing that complete asset chain remains an outstanding hardening task. The baseline CSP also lacks strict script-source restrictions; introducing a strict policy requires coordinating Next.js runtime nonces, theme initialization, workers and WASM. No imported-metadata/DOM XSS exploit was confirmed.

### Low: an unused public image optimizer allowed processing/cache amplification

Unauthenticated clients could request `/_next/image` with distinct path aliases for the same public image, causing repeated image processing and new cache entries. No private-data disclosure was confirmed. The application already uses ordinary images and its authenticated cover API, so this endpoint provided no required functionality.

`next.config.ts` now disables framework image optimization. Unit, production HTTP and Docker-smoke regressions require optimizer requests to return 404 while public icons remain available. The Docker assertion could not be executed locally.

## Dependency and credential checks

- `npm audit --json`: zero reported vulnerabilities across the installed dependency tree.
- `npm audit signatures`: 68 verified registry signatures and 33 verified attestations.
- All 122 locked dependency entries have integrity hashes and HTTPS source URLs.
- Separate OSV queries reported no known advisories for scanner packages `zxing-wasm@3.1.5`, `tesseract.js@6.0.1` and `tesseract.js-core@6.0.0`. This is not a complete audit of their transitive native/WASM assets or runtime delivery chain.
- SheetJS is deliberately pinned to the vendor's integrity-locked `xlsx-0.20.3.tgz`, not the abandoned npm release. OSV's open-ended npm ranges match it mechanically, but the advisory text identifies fixes in 0.19.3 for [CVE-2023-30533](https://osv.dev/vulnerability/GHSA-4r6h-8v6p-xvw6) and 0.20.2 for [CVE-2024-22363](https://osv.dev/vulnerability/GHSA-5pgg-2g8v-p4x9). Neither is a confirmed vulnerability in the pinned version. Registry signature verification does not cover this vendor tarball.
- High-confidence private-key and provider-token pattern checks found no matches in 410 tracked files (including the tracked ZIP's members) or 1,399 historical non-image/non-ZIP Git blobs. These checks do not detect every kind of secret, validate credentials, or cover ignored files, historical archive contents, external logs or backups.
- The same high-confidence credential patterns found no matches in 42 built browser JavaScript files; both scanner integrity values are present in the production bundle.

## Verification environment

The existing 319 unit/integration tests passed before fixes. Database tests use a new, disposable, loopback-only PostgreSQL cluster and randomized schemas, never the application database. Browser tests use mock Google identities rather than real provider credentials.

Final `npm run check` passes: TypeScript, repository-wide formatting and all **351 unit/integration tests**, including the new security regressions. Final `npm run build` also passes and prepares the standalone bundle.

The multi-user browser suite and account-preferences browser suite pass. Real-photo barcode/OCR, enhanced barcode recovery and camera-lifecycle checks also pass with entry-script integrity enabled; the scenario confirmed photos were not uploaded. The dedicated browser-security and disabled-optimizer scenarios passed.

**The full general-purpose e2e suite is not green.** Its latest run passed through mobile adding, then stopped at `series-entry.browser.mjs` because an inherited draft lost Japanese language metadata. Targeted runs also expose the existing Thai-language draft loss in `title-details.browser.mjs`, and language-insensitive catalog matching in `series-missing.browser.mjs` and `volume-editions.browser.mjs` (a Japanese listing appears in a Thai catalog). Later assertions in those four scenarios remain unverified.

These are non-security application blockers, recorded rather than hidden by relaxing language assertions. Browser fixtures were updated for the existing canonical `Manga`/`Light novel`/`Others` type model, preserving language in `edition`; mocks and cleanup avoid unrelated live scraping. A small fix ensures the missing-overview add action retains its selected edition. Remaining production follow-up is in `lib/client/collection.ts`: inherited series defaults/edition selection and `renderSeriesMissing`, including the separate series-detail gap action. Those broader feature repairs are outside this security audit.

Docker execution is unavailable because the local Docker daemon is not running. Container configuration can be reviewed statically, but an image/OS vulnerability scan and a running-container smoke test remain deployment checks. See the [deployment checklist](security.md).

To repeat the checks, first set `BOOKS_TEST_DATABASE_URL` to a dedicated disposable test database as described in the [README](../README.md), then run:

```sh
npm audit
npm audit signatures
npm run check
npm run build
npm run test:e2e
npm run test:multi-user
npm run test:preferences
# With a running Docker daemon:
npm run test:docker
```
