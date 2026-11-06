import { configureEnvironment } from "./environment.mjs";
import { migrateSqlite } from "./sqlite-migration.ts";

configureEnvironment();
const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run db:migrate:sqlite -- path/to/books.sqlite");
  process.exitCode = 1;
} else {
  try {
    const counts = await migrateSqlite(path);
    console.log(
      "SQLite data copied to PostgreSQL. The source file was not modified.",
    );
    console.log(JSON.stringify(counts, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
