import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { openStore } from "../lib/server/store.ts";
import { parseImport, importSummary } from "../lib/server/importer.ts";
import { configureEnvironment } from "./environment.mjs";

configureEnvironment();

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run import -- path/to/collection.xlsx [--preview]");
  process.exit(1);
}
const plan = parseImport(readFileSync(path), basename(path));
if (process.argv.includes("--preview"))
  console.log(JSON.stringify(importSummary(plan), null, 2));
else {
  const store = openStore();
  try {
    console.log(
      JSON.stringify(store.importData(plan, plan.fingerprint), null, 2),
    );
  } finally {
    store.close();
  }
}
