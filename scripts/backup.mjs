import { writeFileSync } from "node:fs";
import { openStore } from "../lib/server/store.ts";
import { configureEnvironment } from "./environment.mjs";

configureEnvironment();

const path =
  process.argv[2] ||
  `book-collection-${new Date().toISOString().slice(0, 10)}.json`;
const store = openStore();
try {
  writeFileSync(path, JSON.stringify(store.exportData(), null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(`Backup saved to ${path}`);
} finally {
  store.close();
}
