# Public-deployment security checklist

See the [2026-11-06–07 security audit](security-audit.md) for review scope, findings and verification limitations.

## Changes included in the Google migration

- Updated Next.js from 16.4.0 to 16.4.5, resolving the critical/high advisories reported by `npm audit` (GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r and GHSA-673q-mjm6-r5xr).
- Removed password authentication, legacy-session acceptance and implicit unauthenticated administrator access, including in development.
- Added state, nonce, PKCE, signed OIDC claim verification, browser binding, one-use expiring transactions and fixed-origin redirects. No first-user-admin or silent account merging.
- Compare full canonical origins (scheme, host and port), reject cross-site mutations, enforce JSON request shapes and bound streamed request bodies.
- Return generic 500 errors for unexpected failures instead of exposing PostgreSQL errors, credentials or other internal exception messages.
- Bound RPC requests to 240 per minute per user, import requests to ten per 15 minutes per user, backup downloads to 20 per 15 minutes per user, and concurrent work to four requests per user. Imports and backup downloads share a one-request process-local large-transfer limit. OAuth starts have a shared limit of 300 per minute and at most 1,000 outstanding ten-minute attempts. Counters persist in PostgreSQL and expired entries are removed.
- Validate XLSX ZIP structure and actual bounded decompression before parsing: at most 16 MiB compressed, 32 MiB expanded and 1,024 entries. Reject encryption, overlapping members and unsupported compression. Bound worksheet dimensions to 20,000 records and 32 columns.
- Disable the framework identification header and add CSP restrictions against framing, plugins, base-URL injection and third-party form destinations. This is a baseline CSP, not strict script-injection protection.

Existing account-isolation checks cover private books, purchases, notes, covers, imports, backups, receipts and saved releases. Stored cover routes require ownership even when an ETag matches. Publisher and cover fetches use HTTPS host allowlists, checked redirects, timeouts and decoded-body size limits. Their transports and AniList pin validated public DNS answers to the HTTPS connection; AniList redirects are rejected. Uploaded cover bytes are signature-checked; SVG is not accepted, but images are not fully decoded/re-encoded. Shared cache inspection, refresh and purge remain administrator-only. Tests cover these boundaries; this review is not an independent penetration test.

The follow-up audit also rejects non-boolean RPC refresh flags before administrator authorization, adds integrity checks to scanner entry scripts, and disables the unused public Next.js image optimizer, preventing unauthenticated processing/cache amplification through that endpoint. Scanner worker/core/language downloads still trust the CDN; entry-script integrity is not complete supply-chain isolation.

## Before exposing the server

- Configure [Google sign-in](authentication.md), verify the admin mapping, and test the real production callback. Missing configuration fails closed. Publish appropriate terms/privacy/contact information before inviting users.
- Back up the database before deployment. Keep databases, logical exports and Google secrets outside publicly served directories and Git. Restrict filesystem/backup access; library backups contain personal data.
- Keep PostgreSQL on a private network, persist and back up its volume, and use strong credentials. Use verified TLS for remote database connections. The Docker image runs as a non-root user with dropped capabilities. Bind the application port to loopback/private networking; expose only a maintained HTTPS reverse proxy. Database mutations are coordinated across app connections; request concurrency limits remain process-local.
- At the proxy, enforce HTTPS, HSTS, connection limits, request timeouts, body-size limits and per-client/IP request rates **before** traffic reaches Node. Strip/overwrite forwarded headers and preserve the public Host header. The app does not trust arbitrary forwarded IPs for rate limits.
- JSON backups support files up to 128 MiB; CSV/XLSX files are limited to 16 MiB, with additional XLSX expansion limits above. CSV uses a bounded text-only parser, and multipart fields are preflighted before FormData allocation. Parsing remains synchronous. Imports and backup download bodies have 120-second deadlines. A single large export still materializes image data and JSON in memory: use storage quotas and process/container memory/CPU limits, plus a stricter proxy upload limit where possible. Application limits do not replace protection against distributed abuse.
- Limit outbound networking to public destinations. Application DNS pinning and allowlists are defense in depth, not a replacement for egress isolation; also block loopback, link-local, private networks and cloud metadata at the network layer.
- Protect logs and avoid recording OAuth callback query strings, authorization codes, cookies or secrets in proxy/access logs. The app does not reflect provider details on login failures.
- Run `npm audit`, `npm run check`, a production build and isolated browser tests for updates. Rebuild images regularly for Node/OS security updates. Monitor storage growth, error rates, Google-signup abuse and remote catalog load; public registration has no account deletion/retention automation yet.

Sessions are bearer credentials. Revoking app access in Google does not immediately revoke existing app sessions; these expire after 14 days or can be removed from the server's `sessions` table. Database/server administrators inherently have access to underlying user data. Do not promise end-to-end encryption or Google-driven session revocation.
