import nextEnv from "@next/env";
import { resolve } from "node:path";

export function configureEnvironment() {
  nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development");
  // The standalone Next server changes its working directory. Resolve the database
  // first so rebuilding the app cannot remove the library with the old bundle.
  const path = process.env.BOOKS_DATABASE_PATH || "./data/books.sqlite";
  process.env.BOOKS_DATABASE_PATH = path === ":memory:" ? path : resolve(path);
}
