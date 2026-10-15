export const testUrl = process.env.BOOKS_TEST_URL;
if (!testUrl)
  throw new Error(
    "Run browser scenarios through npm run test:e2e so they use an isolated test database.",
  );
