# Self-hosting and backups

## Self-host with Docker

Install Docker with the Compose plugin. Copy `.env.example` to `.env` and configure [Google sign-in](authentication.md), including the exact app origin and the admin Google email, then start the app:

```sh
cp .env.example .env
# Edit .env: POSTGRES_PASSWORD, BOOKS_APP_URL, BOOKS_GOOGLE_CLIENT_ID, BOOKS_GOOGLE_CLIENT_SECRET, BOOKS_ADMIN_EMAIL.
docker compose up -d --build --wait
```

Open the exact `BOOKS_APP_URL` and choose **Continue with Google**. Local HTTP is supported only on localhost/loopback. Set `BOOKS_PORT` in `.env` to use a different host port, and update both `BOOKS_APP_URL` and Google's authorized redirect URI to match.

PostgreSQL 18 runs as a separate service, with its data in the persistent `postgres-data` volume. A fresh deployment starts empty; import your workbook or backup from **Data & backups**. Use a strong URL-safe `POSTGRES_PASSWORD`, such as `openssl rand -hex 32`; the example password is for local development only. Compose supplies the app's internal `DATABASE_URL` automatically. PostgreSQL is published only on loopback (`BOOKS_DB_PORT`, default 5432) for local development and administration. Update with `docker compose up -d --build --wait`; the database is retained. Stop with `docker compose down`. **Do not add `--volumes` when stopping your installation:** that deletes the library. Changing `POSTGRES_PASSWORD` after initialization does not change the existing database role's password; rotate it in PostgreSQL too.

Compose publishes on `127.0.0.1` by default. For remote access, put your HTTPS reverse proxy in front of the app and set `BOOKS_APP_URL` to the public HTTPS origin; cookies become Secure automatically. Change `BOOKS_BIND_ADDRESS` only if your proxy needs another host interface, and preserve the original `Host` header when forwarding requests. Follow the [security checklist](security.md) for proxy limits, headers, egress and secret handling.

The image uses Node.js 24, a multi-stage build and the standalone Next.js bundle, runs as an unprivileged user, and excludes local databases, environment files and backups from the build context. `/api/health` checks the database connection without returning library data. Compose waits for the health check and allows 30 seconds for graceful shutdown. View status with `docker compose ps` and logs with `docker compose logs -f books`.

To build an image without Compose:

```sh
docker build -t meemai .
docker run -d --name meemai --init \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  -e DATABASE_URL=postgresql://books:YOUR_PASSWORD@YOUR_DATABASE_HOST:5432/books \
  meemai
```

The standalone app needs an existing PostgreSQL database reachable from its container. Use a verified TLS connection for a remote database (for example `sslmode=verify-full` with your provider's CA); do not disable certificate validation. Startup applies forward schema migrations under a database lock. The app uses a bounded connection pool, with account mutations serialized transactionally across connections.

## Migrate an existing SQLite installation

1. Stop the old app so no more writes reach SQLite. Keep a backup of its entire data volume; do not remove the old `books-data` volume when updating Compose.
2. Start PostgreSQL and set `DATABASE_URL` in `.env.local` to an **empty** target database. Install dependencies with `npm ci`.
3. Copy the old `books.sqlite` and any `-wal`/`-shm` files together from the stopped installation, then run:

   ```sh
   npm run db:migrate:sqlite -- /path/to/books.sqlite
   ```

4. Start the new app using that PostgreSQL database and verify your libraries and sign-in before retiring the old deployment.

The migration opens SQLite read-only and copies every account, book (including trash), receipt, saved release, catalog link, option, import record, stored image and cache entry in one PostgreSQL transaction, preserving IDs and resetting identity sequences. Account preferences and Google-bound sessions are preserved when present. Legacy password sessions are discarded and password hashes cleared. SQLite schema versions 5–7 are supported; upgrade older files using the previous app first. A populated or claimed target is rejected, and a failed copy rolls back. Old filesystem cover caches can optionally be mounted read-only and located with `BOOKS_LEGACY_COVERS_PATH`; covers already stored in SQLite need no filesystem mount.

Live camera access requires HTTPS or localhost. Taking or choosing barcode photos still uses the same local browser decoder and text recognition.

## Install as an app

meemai can be installed as a Progressive Web App (PWA) from a production deployment. In Chrome or Edge, use the browser's **Install app** option. On iPhone or iPad, open the library in Safari, tap **Share**, then **Add to Home Screen**. The installed app opens in its own window with the library's book icon.

Installation and offline support require HTTPS, or localhost for local use. A plain HTTP address on your local network does not enable the service worker. Build with `npm run build` and run with `npm start`; service worker registration is disabled during `npm run dev`.

After the first online visit, the app can show an offline screen when the library server cannot be reached. **Try again** reloads the same page when your connection returns. Viewing, editing, scanning lookups and backups still need a connection to the server. The service worker caches only the public offline screen; library pages, covers, authentication responses and API data are not stored in its offline cache.

## Backups and restoration

Choose **Data & backups → Download library backup**. The JSON file contains owned books, removed books, saved releases, catalog links, dropdown choices and stored cover images. Download it regularly and keep a copy outside the server.

The command-line equivalent is:

```sh
npm run backup -- /path/to/meemai-backup.json
```

To restore, import that backup into an empty database through the UI or CLI. Record IDs and revision tokens are regenerated during restoration; the library records are preserved. A logical export uses one database transaction for a consistent snapshot. It excludes login sessions, request receipts and disposable catalog caches.

Existing backups remain compatible. The JSON format identifier stays `book-collection` even though downloaded files now use the `meemai` name.

For a full database backup, including all accounts and settings, use PostgreSQL's consistent logical backup:

```sh
docker compose exec -T postgres pg_dump -U books -d books -Fc > books.dump
# Restore only into an empty database:
docker compose exec -T postgres pg_restore -U books -d books --no-owner < books.dump
```

Protect dumps as private data and keep a copy outside the host. Do not copy a running PostgreSQL data directory as a backup. Keep the Docker volume when updating; deleting it deletes every library.
