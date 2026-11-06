# Google sign-in

Google is the only authentication method. Anyone with a verified Google email can sign up; each new account receives an empty, private library and the ordinary `user` role. The first public signup is **never** made an administrator. Password sign-in and unauthenticated mode are removed; old `BOOKS_PASSWORD`, `BOOKS_ALLOW_UNAUTHENTICATED` and `BOOKS_SECURE_COOKIES` settings have no effect.

## Configure Google Cloud

1. Create a Google Cloud project and configure **Google Auth Platform → Branding, Audience and Data Access**. Choose an external audience for public use. Request only `openid` and `email`; the app does not request access to Gmail, Drive or Contacts. Supply accurate application, support and privacy information required by Google.
2. Create an OAuth client of type **Web application**. Add the exact authorized redirect URI:
   - Development: `http://localhost:3000/api/auth/google/callback`
   - Production: `https://books.example.com/api/auth/google/callback`
3. While the Google application is in Testing, add the accounts you will use as test users. Move the consent application to Production before inviting the public, completing any requirements Google presents.
4. Set the following server-side environment variables, using `.env.local` for development or `.env` for Compose:

   ```dotenv
   BOOKS_APP_URL=https://books.example.com
   BOOKS_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
   BOOKS_GOOGLE_CLIENT_SECRET=your-client-secret
   BOOKS_ADMIN_EMAIL=your-admin@gmail.com
   ```

`BOOKS_APP_URL` is an origin only, with no path, query or fragment. HTTPS is required except for localhost/loopback. Match the hostname and port exactly, including during local testing. Redirect URIs and origin checks never trust forwarded headers. Cookies are automatically Secure and use the `__Host-` prefix on HTTPS to prevent sibling-subdomain cookie injection; there is no insecure-cookie override. Keep the client secret out of browser variables, Git and images; inject it at runtime.

## Preserve an existing library

Back up the database before upgrading. For an existing SQLite deployment, use the [PostgreSQL migration command](self-hosting.md#migrate-an-existing-sqlite-installation): it preserves accounts and books, clears obsolete password hashes, discards password sessions and retains Google-bound sessions. Nothing is reseeded or reassigned to a public registrant.

The verified Gmail or Google Workspace account matching `BOOKS_ADMIN_EMAIL` claims the existing `admin` library (user ID 1) on its first Google sign-in. This links the library permanently to Google's immutable subject identifier. Changing the environment variable afterwards **does not** transfer the library or grant another account administrator privileges.

Other existing password accounts need an explicit server-side mapping before their first Google sign-in:

```sh
npm run user:add -- existing-username reader@gmail.com --link
```

For email-based linking, use Gmail or a Google Workspace account whose signed `hd` domain matches the email domain. Google is not authoritative for arbitrary third-party email addresses attached to Google accounts, so those addresses cannot claim a pre-existing library. They can still sign up with a fresh, private library.

To reserve an additional account or trusted administrator before signup:

```sh
npm run user:add -- username reader@gmail.com
npm run user:add -- trusted-admin colleague@your-workspace.example --admin
```

Run these commands on the server with the intended `DATABASE_URL`. `--link` never reassigns an already-linked identity. There is no automatic merging by name or email, and no public account-linking endpoint. Account recovery/reassignment requires a deliberate server-admin operation and a database backup; do not clear subjects casually.

## Flow and testing

Sign-in starts with a same-origin POST. The server uses the authorization-code flow with PKCE S256, random state, nonce, a browser-bound HttpOnly cookie and a one-use PostgreSQL attempt expiring after ten minutes. `openid-client` validates Google's issuer, audience, expiration, nonce and RS256 signature. Only verified email identities can create sessions. Google tokens are discarded; only hashes of random app-session tokens are stored. Sessions expire after 14 days, with at most ten active sessions per account. Sign-out revokes the current session.

`node --test tests/integration/google-auth.test.mjs tests/integration/http-security.test.mjs` exercises real OIDC validation with test-only signed Google responses. Browser tests explicitly preload a mock transport; production has no mock-provider switch or alternate issuer setting. Perform one real Google sign-in against the final HTTPS origin before launch, since offline tests cannot validate your Cloud Console configuration.
