import assert from "node:assert/strict";
import { seriesPath } from "../../lib/domain/navigation.ts";

export async function checkAdminEditConflicts(page, post, bumpRevision) {
  const series = "Admin edit conflict fixtures";
  for (const volume of [1, 2, 3])
    await post("saveBook", {
      requestId: crypto.randomUUID(),
      book: {
        series,
        volume,
        type: "Other",
        status: "Reading",
        note: "Original note",
      },
    });
  await page.route("**/api/rpc", (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getBookCover")
      return route.fulfill({ json: { row: arg.row, coverId: "" } });
    if (name === "getAnimeAdaptations")
      return route.fulfill({
        json: { items: [], exactId: null, complete: true },
      });
    return route.fallback();
  });
  const shelf = async () =>
    (await post("getCollection")).books.filter(
      (book) => book.series === series,
    );
  const original = await shelf();
  const remoteEdit = async (index, updates) => {
    const book = (await shelf())[index];
    await post("saveBook", {
      requestId: crypto.randomUUID(),
      row: book.row,
      token: book.token,
      book: { ...book, ...updates },
    });
  };
  const ready = () =>
    page.waitForFunction(
      () =>
        !!window.bookCollection?.state.data &&
        !window.bookCollection.state.busy,
    );
  const closed = () =>
    page.waitForFunction(
      () =>
        !document.getElementById("bookDialog").open &&
        !window.bookCollection.state.busy,
    );
  const conflict = page.getByRole("dialog", {
    name: "Resolve edit conflict",
    exact: true,
  });
  const choice = (index, field, value) =>
    conflict.locator(
      `[data-row="${original[index].row}"] [data-field="${field}"] input[value="${value}"]`,
    );
  const confirm = () =>
    conflict
      .getByRole("button", { name: "Save selected values", exact: true })
      .click();
  await page.goto(new URL(seriesPath(series), page.url()).href);
  await ready();

  // A stale collection is not a conflict when the edited row is unchanged.
  await page.locator(".book-row").first().click();
  await page.locator("#source").fill("Single local edit");
  await remoteEdit(2, { note: "Unrelated row changed" });
  await page.locator("#saveButton").click();
  await closed();
  assert.equal(await conflict.count(), 0);
  assert.equal((await shelf())[0].source, "Single local edit");
  assert.equal((await shelf())[2].note, "Unrelated row changed");

  // Same-row changes show original/current/draft, require a choice, and can cancel.
  const draft = "<script>window.bookConflictXss=true</script>My note";
  await page.locator(".book-row").first().click();
  await page.locator("#note").fill(draft);
  await remoteEdit(0, { note: "Remote note", pageCount: 222 });
  await page.locator("#saveButton").click();
  await conflict.waitFor();
  assert.match(await conflict.innerText(), /Original note/);
  assert.match(await conflict.innerText(), /Remote note/);
  assert.ok((await conflict.innerText()).includes(draft));
  assert.equal(await conflict.locator("script, iframe").count(), 0);
  assert.equal(await page.evaluate(() => window.bookConflictXss), undefined);
  assert.equal(
    await conflict.locator("form").evaluate((form) => form.checkValidity()),
    false,
  );
  assert.equal((await shelf())[0].note, "Remote note");
  await conflict
    .getByRole("button", { name: "Back to editing", exact: true })
    .click();
  await ready();
  assert.equal(await page.locator("#note").inputValue(), draft);
  await page.locator("#saveButton").click();
  await conflict.waitFor();
  await choice(0, "note", "mine").check();
  assert.equal(await choice(0, "pageCount", "latest").isChecked(), true);
  // Saving a reviewed token is still conditional: another edit triggers a new diff.
  await remoteEdit(0, { note: "Newer remote note" });
  const repeatedConflict = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/rpc") &&
      response.request().postDataJSON()?.name === "saveBook" &&
      response.status() === 409,
  );
  await confirm();
  await repeatedConflict;
  await conflict.getByText("Newer remote note", { exact: true }).waitFor();
  await choice(0, "note", "latest").check();
  await confirm();
  await closed();
  assert.equal((await shelf())[0].note, "Newer remote note");
  assert.equal((await shelf())[0].pageCount, 222);

  // Identical row data with a newer revision retries without asking the admin.
  await page.locator(".book-row").first().click();
  await page.locator("#source").fill("Revision-only retry");
  await bumpRevision(original[0].row);
  await page.locator("#saveButton").click();
  await closed();
  assert.equal(await conflict.count(), 0);
  assert.equal((await shelf())[0].source, "Revision-only retry");

  // Bulk edits review only the conflicting rows and commit all rows together.
  await page.locator("#editVolumesButton").click();
  for (const index of [0, 1]) {
    const row = page.locator(
      `.series-edit-volume[data-row="${original[index].row}"]`,
    );
    await row.locator(".series-edit-toggle").click();
    await page
      .locator(`#volume-${original[index].row}-note`)
      .fill(`Bulk mine ${index}`);
  }
  await page
    .locator(`#volume-${original[2].row}-source`)
    .fill("Bulk untouched row");
  await remoteEdit(0, { note: "Bulk remote 0", pageCount: 333 });
  await remoteEdit(1, { note: "Bulk remote 1" });
  await page.locator("#saveSeriesEdits").click();
  await conflict.waitFor();
  assert.equal(await conflict.locator(".book-conflict-row").count(), 2);
  assert.equal((await shelf())[2].source, "");
  await choice(0, "note", "mine").check();
  await choice(1, "note", "latest").check();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(
    await conflict.evaluate(
      (dialog) => dialog.scrollWidth <= dialog.clientWidth,
    ),
    true,
  );
  const attempts = [];
  await page.route("**/api/rpc", (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name !== "saveSeriesVolumes") return route.fallback();
    attempts.push(arg);
    if (attempts.length === 1)
      return route.fulfill({
        status: 503,
        json: { message: "Temporary save failure" },
      });
    return route.fallback();
  });
  await confirm();
  await page.locator("#seriesEditError").waitFor();
  await ready();
  await page.locator("#saveSeriesEdits").click();
  await page.waitForFunction(
    () =>
      document.getElementById("seriesEditor").hidden &&
      !window.bookCollection.state.busy,
  );
  assert.equal(attempts.length, 2);
  assert.deepEqual(
    attempts[0],
    attempts[1],
    "retry retains the resolved values and receipt ID",
  );
  const saved = await shelf();
  assert.equal(saved[0].note, "Bulk mine 0");
  assert.equal(saved[0].pageCount, 333);
  assert.equal(saved[1].note, "Bulk remote 1");
  assert.equal(saved[2].source, "Bulk untouched row");
  console.log(
    "PASS row-scoped admin edit conflicts, three-way diff choices, cancellation, concurrent rechecks, automatic retry and atomic bulk saves",
  );
}
