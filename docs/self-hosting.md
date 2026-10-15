# Self-hosting and backups

## Self-host with Docker

Install Docker with the Compose plugin. Copy `.env.example` to `.env` and set `BOOKS_PASSWORD` to a long private password, then start the app:

```sh
cp .env.example .env
# Edit .env and set BOOKS_PASSWORD.
docker compose up -d --build --wait
```

Open <http://localhost:3000> and sign in with that password. The default cookie setting supports local HTTP. Set `BOOKS_PORT` in `.env` to use a different host port.

The database lives in the persistent `books-data` volume. A fresh deployment starts empty; import your workbook or backup from **Data & backups**. Use one app instance with its local SQLite volume. Update with `docker compose up -d --build --wait`; the database is retained. Stop with `docker compose down`. **Do not add `--volumes` when stopping your installation:** that deletes the library.

Compose publishes on `127.0.0.1` by default. For remote access, put your HTTPS reverse proxy in front of the app and set `BOOKS_SECURE_COOKIES=true`. Change `BOOKS_BIND_ADDRESS` only if your proxy needs another host interface, and preserve the original `Host` header when forwarding requests.

The image uses Node.js 24, a multi-stage build and the standalone Next.js bundle, runs as an unprivileged user, and excludes local databases, environment files and backups from the build context. `/api/health` checks the database connection without returning library data. Compose waits for the health check and allows 30 seconds for graceful shutdown. View status with `docker compose ps` and logs with `docker compose logs -f books`.

To build an image without Compose:

```sh
docker build -t book-collection .
docker run -d --name book-collection --init \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  -e BOOKS_DATABASE_PATH=/app/data/books.sqlite \
  -v books-data:/app/data \
  book-collection
```

Compose uses a project-prefixed volume name; the standalone command uses a separate volume named `books-data`.

Live camera access requires HTTPS or localhost. Taking or choosing barcode photos still uses the same local browser decoder and text recognition.

## Backups and restoration

Choose **Data & backups → Download library backup**. The JSON file contains owned books, removed books, saved releases, catalog links, dropdown choices and stored cover images. Download it regularly and keep a copy outside the server.

The command-line equivalent is:

```sh
npm run backup -- /path/to/book-collection-backup.json
```

To restore, import that backup into an empty database through the UI or CLI. Record IDs and revision tokens are regenerated during restoration; the library records are preserved. A logical export uses one database transaction for a consistent snapshot. It excludes login sessions, request receipts and disposable catalog caches.

For a raw database backup, stop the container before copying its volume, or use SQLite's backup facility. Do not copy only `books.sqlite` while the app is writing: committed changes can still be in its WAL file. Keep the Docker volume when updating; deleting the volume deletes the library.
