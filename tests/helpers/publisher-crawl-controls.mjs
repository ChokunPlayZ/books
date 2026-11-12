import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

export async function checkPublisherCrawlControls(page, store, queue) {
  const id = crypto.randomUUID();
  const label = "Publisher crawl recovery fixture";
  const productUrl =
    "https://yenpress.com/titles/9780316769488-" +
    "long-book-title-".repeat(18);
  const jobId = await queue.enqueue("crawlPublisher", { id }, label, -100);
  await store.db
    .prepare(
      "UPDATE scrape_jobs SET status='failed',finished_at=?,error=? WHERE id=?",
    )
    .run(Date.now(), "Warm product details: Website DNS ENOTFOUND", jobId);
  await store.db
    .prepare(
      `INSERT INTO publisher_crawls(id,publisher_id,mode,status,user_id,job_id,created_at,updated_at,frontier,error,warnings)
    VALUES (?,'yenpress','all','failed',1,?,?,?,?::jsonb,?,?::jsonb)`,
    )
    .run(
      id,
      jobId,
      Date.now(),
      Date.now(),
      JSON.stringify([
        { kind: "book", url: productUrl, title: "หนังสือทดสอบ เล่ม 1" },
      ]),
      "Warm product details · " + productUrl + ": Website DNS ENOTFOUND",
      JSON.stringify(["Failed at product verification · " + productUrl]),
    );
  await store.db.query(
    `INSERT INTO scrape_job_events(job_id,created_at,message)
    SELECT $1,$2,'Stage event ' || n FROM generate_series(1,250) n`,
    [jobId, Date.now()],
  );
  await store.db
    .prepare(
      "INSERT INTO scrape_job_events(job_id,created_at,message) VALUES (?,?,?)",
    )
    .run(
      jobId,
      Date.now(),
      "Stage failed · Warm product details · " +
        productUrl +
        " · DNS ENOTFOUND",
    );
  await page
    .getByRole("button", { name: "Publisher crawls", exact: true })
    .click();
  const card = page.locator(".admin-records .admin-card").filter({
    has: page.getByRole("heading", {
      name: "Yen Press · All discoverable series",
      exact: true,
    }),
  });
  await card
    .getByRole("button", { name: "Resume crawl", exact: true })
    .waitFor();
  mkdirSync("outputs", { recursive: true });
  for (const [width, theme] of [
    [320, "light"],
    [390, "dark"],
    [1280, "light"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `crawl controls overflow at ${width}px/${theme}`,
    );
    await page.screenshot({
      path: `outputs/publisher-crawls-${width}-${theme}.png`,
      fullPage: true,
    });
  }
  await card.getByRole("button", { name: "Task details", exact: true }).click();
  const detail = page.locator("section.admin-card").filter({
    has: page.getByRole("heading", {
      name: "Task details: " + label,
      exact: true,
    }),
  });
  await detail
    .getByRole("heading", { name: "Task details: " + label, exact: true })
    .waitFor();
  assert.equal(await detail.locator(".admin-events li").count(), 200);
  assert.match(
    await detail.locator(".admin-events").innerText(),
    /DNS ENOTFOUND/,
  );
  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "long request URLs must wrap in job history",
  );
  await detail.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".admin-events li").length === 52,
  );
  assert.equal(
    await page.getByLabel("Live updates", { exact: true }).isChecked(),
    false,
  );
  await page
    .getByRole("button", { name: "Publisher crawls", exact: true })
    .click();
  await card.getByRole("button", { name: "Resume crawl", exact: true }).click();
  await card
    .getByRole("button", { name: "Pause crawl", exact: true })
    .waitFor();
  const resumed = await store.db
    .prepare("SELECT status,job_id FROM publisher_crawls WHERE id=?")
    .get(id);
  assert.equal(resumed.status, "running");
  assert.notEqual(resumed.job_id, jobId);
  assert.equal(
    (
      await store.db
        .prepare("SELECT status FROM scrape_jobs WHERE id=?")
        .get(resumed.job_id)
    ).status,
    "queued",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Cancel crawl", exact: true }).click();
  await card.getByText("cancelled", { exact: true }).waitFor();
  await page.getByLabel("Live updates", { exact: true }).check();
  await page.setViewportSize({ width: 1280, height: 900 });
}
