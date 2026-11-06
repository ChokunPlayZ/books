// Build and exercise the real image using a disposable Compose project and volume.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "books-docker-"));
const envFile = join(directory, ".env");
writeFileSync(envFile, "");
const env = {
  ...process.env,
  BOOKS_APP_URL: "http://localhost:3000",
  BOOKS_GOOGLE_CLIENT_ID: "docker-test-google-client",
  BOOKS_GOOGLE_CLIENT_SECRET: "docker-test-google-secret",
  BOOKS_ADMIN_EMAIL: "owner@gmail.com",
  BOOKS_BIND_ADDRESS: "127.0.0.1",
  BOOKS_PORT: "0",
};
const args = [
  "compose",
  "--project-name",
  `books-smoke-${process.pid}-${randomBytes(4).toString("hex")}`,
  "--env-file",
  envFile,
  "--file",
  join(root, "compose.yaml"),
];
function compose(command, capture = false) {
  return execFileSync("docker", [...args, ...command], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    timeout: 600000,
  })?.trim();
}

let url;
let cookie;
async function request(path, options = {}) {
  return fetch(url + path, {
    ...options,
    headers: {
      Cookie: cookie || "",
      Origin: env.BOOKS_APP_URL,
      ...options.headers,
    },
    signal: AbortSignal.timeout(10000),
  });
}
async function json(path, options) {
  const response = await request(path, options);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}
const rpc = (name) =>
  json("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
function address() {
  url = "http://" + compose(["port", "books", "3000"], true);
}

try {
  compose(["up", "--detach", "--build", "--wait", "--wait-timeout", "120"]);
  address();
  assert.notEqual(compose(["exec", "-T", "books", "id", "-u"], true), "0");
  assert.deepEqual(await json("/api/health"), { status: "ok" });
  assert.equal((await request("/api/backup")).status, 401);
  const protectedDataPage = await request("/data", { redirect: "manual" });
  assert.equal(protectedDataPage.status, 307);
  assert.equal(protectedDataPage.headers.get("location"), "/login");
  assert.equal(
    (
      await request("/api/login", {
        method: "POST",
      })
    ).status,
    410,
  );
  const login = await request("/api/auth/google", {
    method: "POST",
    redirect: "manual",
  });
  assert.equal(login.status, 303);
  assert.equal(
    new URL(login.headers.get("location")).origin,
    "https://accounts.google.com",
  );
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  // Seed a real subject-bound session directly in the disposable database.
  // Real Cloud Console credentials are intentionally not needed by this test.
  const token = randomBytes(32).toString("hex");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  compose([
    "exec",
    "-T",
    "books",
    "node",
    "-e",
    `
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(process.env.BOOKS_DATABASE_PATH);
    db.prepare("UPDATE users SET google_subject='docker-owner',email='owner@gmail.com' WHERE id=1").run();
    db.prepare("INSERT INTO sessions (token_hash,expires_at,user_id,credential_hash) VALUES (?,?,1,?)").run(${JSON.stringify(hash(token))},Date.now()+86400000,${JSON.stringify(hash("google:docker-owner"))});
    db.close();
  `,
  ]);
  cookie = "book_collection_session=" + token;
  assert.equal((await rpc("getCollection")).books.length, 0);
  const page = await request("/");
  assert.equal(page.status, 200);
  const asset = (await page.text()).match(
    /(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/,
  );
  assert.ok(asset, "The page must reference a built static asset");
  assert.equal((await request(asset[1])).status, 200);
  const dataPage = await request("/data");
  assert.equal(dataPage.status, 200);
  assert.match(await dataPage.text(), /Download library backup/);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [
        "ISBN",
        "Series",
        "Type",
        "Publisher",
        "Status",
        "Volume",
        "Source",
        "Price",
        "Date",
        "Note",
      ],
      [
        "9780140328721",
        "Docker persistence check",
        "Manga (TH)",
        "",
        "Read",
        1,
        "",
        0,
        "",
        "",
      ],
    ]),
    "Sheet1",
  );
  const file = new Blob([
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  ]);
  function form(action, fingerprint) {
    const body = new FormData();
    body.set("file", file, "collection.xlsx");
    body.set("action", action);
    if (fingerprint) body.set("fingerprint", fingerprint);
    return { method: "POST", body };
  }
  const preview = await json("/api/import", form("preview"));
  await json("/api/import", form("import", preview.fingerprint));
  assert.equal((await rpc("getCollection")).books.length, 1);

  // Recreate the container to prove that both the database and sessions use the volume.
  compose([
    "up",
    "--detach",
    "--force-recreate",
    "--wait",
    "--wait-timeout",
    "120",
  ]);
  address();
  const collection = await rpc("getCollection");
  assert.equal(collection.books.length, 1);
  assert.equal(collection.books[0].series, "Docker persistence check");
  assert.equal((await json("/api/backup")).books.length, 1);
  console.log(
    "PASS Docker health, non-root user, Google auth start, protected sessions, static assets, Data & backups page, Excel import, and persistence after container recreation",
  );
} finally {
  try {
    compose(["down", "--volumes", "--rmi", "local", "--remove-orphans"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
