import test from "node:test";
import assert from "node:assert/strict";
import { crawlRobots } from "../../lib/server/crawl-robots.ts";
test("publisher crawls honor robots disallow, specific allow, agent groups and crawl delay", () => {
  const text =
    "User-agent: *\nDisallow: /private*\nAllow: /private/public\nCrawl-delay: 30";
  assert.deepEqual(
    crawlRobots(text, new URL("https://yenpress.com/private/book")),
    { allowed: false, delay: 30000 },
  );
  assert.equal(
    crawlRobots(text, new URL("https://yenpress.com/private/public/book"))
      .allowed,
    true,
  );
  assert.equal(
    crawlRobots(
      "User-agent: *\nDisallow: /\nUser-agent: meemai\nAllow: /",
      new URL("https://yenpress.com/series"),
    ).allowed,
    true,
  );
});
