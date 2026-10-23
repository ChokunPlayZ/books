import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium } from "playwright";
import { testUrl } from "../helpers/browser.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const ready = (page) =>
  page.waitForFunction(() => !!window.bookCollection?.state.data);
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rpc = async (name, arg) => {
    const response = await page.request.post(testUrl + "/api/rpc", {
      data: { name, arg },
    });
    assert.equal(response.status(), 200);
    return response.json();
  };
  await page.goto(testUrl + "/stats");
  await ready(page);
  await page
    .getByRole("heading", { name: "Your story in numbers starts here" })
    .waitFor();
  const base = {
    isbn: "",
    series: "Statistics Alpha",
    type: "Other",
    publisher: "Press A",
    status: "Read",
    source: "Store A",
    price: 100,
    date: "2026-01-01",
    note: "",
  };
  for (const [index, changes] of [
    {},
    { price: 200, date: "2026-03-01", status: "Reading", source: "Store B" },
    { price: 0, date: "2025-12-01" },
    { price: "", date: "2026-03-02" },
    {
      series: "Statistics Beta",
      price: 50,
      date: "",
      source: "",
      publisher: "",
    },
    { series: "Statistics Removed", price: 9999 },
  ].entries()) {
    await rpc("saveBook", {
      requestId: crypto.randomUUID(),
      book: { ...base, volume: index + 1, ...changes },
    });
  }
  const removed = (await rpc("getCollection")).books.find(
    (book) => book.series === "Statistics Removed",
  );
  await rpc("removeBook", {
    requestId: crypto.randomUUID(),
    row: removed.row,
    token: removed.token,
  });
  await page.reload();
  await ready(page);
  const metric = (label) =>
    page
      .locator(".analytics-metric")
      .filter({ has: page.getByRole("heading", { name: label, exact: true }) })
      .locator(".analytics-value");
  assert.equal(await metric("Total spent").textContent(), "฿350");
  assert.equal(await metric("Average paid per book").textContent(), "฿87.5");
  assert.equal(await metric("Books acquired").textContent(), "5");
  assert.equal(
    await page.locator("#statsTab").getAttribute("aria-current"),
    "page",
  );
  assert.match(
    await page.locator(".analytics-trend-note").textContent(),
    /1 book.*฿50/,
  );
  await page.getByLabel("Purchase period").selectOption("2026");
  assert.equal(await metric("Total spent").textContent(), "฿300");
  assert.equal(await metric("Average paid per book").textContent(), "฿150");
  assert.equal(await metric("Books acquired").textContent(), "3");
  await page.getByText("View trend data table", { exact: true }).click();
  const march = page
    .locator(".analytics-table tbody tr")
    .filter({ hasText: "Mar 2026" });
  assert.deepEqual(await march.locator("td").allTextContents(), [
    "฿200",
    "2",
    "1",
  ]);
  assert.equal(await page.locator(".analytics-table tbody tr").count(), 12);
  await page.getByRole("button", { name: "Books", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Books", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page
      .locator(".analytics-column")
      .nth(2)
      .locator(".analytics-bar-value")
      .textContent(),
    "2",
  );

  // Adding a book from this page must update the current period without navigation.
  await page.locator("#addButton").click();
  await page.locator("#series").fill("Statistics Gamma");
  await page.locator("#price").fill("25");
  await page.locator("#date").fill("2026-04-01");
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () =>
      !document.getElementById("bookDialog").open &&
      !window.bookCollection?.state.busy,
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".analytics-metric")]
        .find((card) => card.querySelector("h2").textContent === "Total spent")
        ?.querySelector(".analytics-value").textContent === "฿325",
  );
  assert.equal(await page.getByLabel("Purchase period").inputValue(), "2026");
  await page.getByLabel("Purchase period").selectOption("all");
  assert.equal(await metric("Total spent").textContent(), "฿375");
  await page.locator("#toast").waitFor({ state: "hidden" });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  await page.screenshot({
    path: join(process.cwd(), "outputs", "statistics-desktop.png"),
    fullPage: true,
  });
  await page.getByLabel("Purchase period").selectOption("2026");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(process.cwd(), "outputs", "statistics-phone.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: join(process.cwd(), "outputs", "statistics-dark.png"),
    fullPage: true,
  });
  await page
    .getByRole("region", { name: "Spending by series", exact: true })
    .getByRole("link", { name: "Statistics Alpha", exact: true })
    .click();
  await ready(page);
  assert.equal(
    await page.locator("#seriesTitle").textContent(),
    "Statistics Alpha",
  );
  await page.goBack();
  await ready(page);
  assert.equal(new URL(page.url()).pathname, "/stats");

  const plain = await browser.newContext({ javaScriptEnabled: false });
  const serverPage = await plain.newPage();
  await serverPage.goto(testUrl + "/stats");
  assert.equal(
    await serverPage
      .getByRole("heading", { name: "Statistics", exact: true })
      .count(),
    1,
  );
  assert.match(
    await serverPage.locator(".analytics-metrics").textContent(),
    /฿375/,
  );
  await plain.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS statistics totals, date filters, free/unknown prices, excluded removed books, trends, live additions, server rendering, navigation and responsive themes",
  );
} finally {
  await browser.close();
}
