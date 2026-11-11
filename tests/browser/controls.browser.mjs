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

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/rpc", (route) => {
    const { name, arg } = route.request().postDataJSON();
    if (name === "getPublisherReleases")
      return route.fulfill({ json: { items: [], complete: true } });
    if (name === "getPublisherDirectory")
      return route.fulfill({
        json: { url: arg.url, titles: [], items: [], complete: true },
      });
    if (name === "getSeasonalThaiBooks")
      return route.fulfill({
        json: {
          items: [],
          thaiSources: [],
          season: arg.season,
          year: arg.year,
          checkedAt: Date.now(),
        },
      });
    return route.continue();
  });
  const menu = page.locator(".dropdown-menu:popover-open");
  const ready = () =>
    page.waitForFunction(() => !!window.bookCollection?.state.data);
  const inViewport = async () => {
    const box = await menu.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box && box.width > 0 && box.height > 0);
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1);
    assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  };
  const open = async (control) => {
    await control.click();
    await menu.waitFor();
    assert.equal(await control.getAttribute("aria-expanded"), "true");
    assert.equal(
      await control.getAttribute("aria-controls"),
      await menu.getAttribute("id"),
    );
    assert.equal(
      await control.evaluate((el) => getComputedStyle(el).appearance),
      "none",
    );
    await inViewport();
  };

  // Every route, including less prominent filter and preference dropdowns.
  for (const path of [
    "/",
    "/missing",
    "/releases",
    "/discover",
    "/stats",
    "/removed",
    "/search",
    "/data",
  ]) {
    await page.goto(testUrl + path);
    if (path === "/data") await page.waitForLoadState("networkidle");
    else await ready();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const control of await page.locator("select:visible").all()) {
        if (await control.isDisabled()) continue;
        const original = await control.inputValue();
        const controls = await control.getAttribute("aria-controls");
        await open(control);
        assert.ok(await menu.getByRole("option").count());
        await page.keyboard.press("End");
        await page.keyboard.press("Escape");
        assert.equal(await menu.count(), 0);
        assert.equal(await control.inputValue(), original);
        assert.equal(await control.getAttribute("aria-controls"), controls);
      }
    }
    if (path === "/") {
      await page.locator("#collectionFilters > summary").click();
      for (const control of await page
        .locator(".collection-filter-grid select")
        .all()) {
        await open(control);
        await page.keyboard.press("Escape");
      }
      await page.locator("#toggleSelection").click();
      await open(page.locator("#bulkStatus"));
      await page.keyboard.press("Escape");
      await page.locator("#toggleSelection").click();
    }
    if (path === "/discover") {
      await page.locator("#discoveryMode").selectOption("anime");
      for (const control of await page.locator(".anime-filters select").all()) {
        await open(control);
        await page.keyboard.press("Escape");
      }
      await page.locator("#discoveryMode").selectOption("publisher");
    }
  }

  await page.goto(testUrl);
  await ready();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#addButton").click();
  const type = page.locator("#type");
  await type.tap();
  await menu.waitFor();
  await inViewport();
  await menu.getByRole("option", { name: "Light novel", exact: true }).tap();
  assert.equal(await type.inputValue(), "Light novel");
  assert.equal(await menu.count(), 0);
  assert.equal(await page.locator("#bookDialog").isVisible(), true);

  await type.tap();
  await menu.waitFor();
  await type.tap();
  assert.equal(await menu.count(), 0, "A second touch tap closes the menu");

  // A touch sequence can end without a click in WebKit. Also exercise the
  // compatibility-click path and interrupted gestures deterministically.
  const pointer = (name, extra = {}) =>
    type.dispatchEvent(name, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 100,
      clientY: 100,
      ...extra,
    });
  await pointer("pointerdown");
  await pointer("pointerup");
  await menu.waitFor();
  await type.dispatchEvent("click", { detail: 1 });
  assert.equal(
    await menu.count(),
    1,
    "A compatibility click must not close the menu",
  );
  await type.press("Escape");
  await pointer("pointerdown");
  await pointer("pointermove", { clientY: 140 });
  await pointer("pointerup");
  assert.equal(
    await menu.count(),
    0,
    "Scrolling across a selector is not a tap",
  );
  await pointer("pointerdown");
  await pointer("pointercancel");
  await pointer("pointerup");
  assert.equal(
    await menu.count(),
    0,
    "A cancelled gesture must not open the menu",
  );
  await pointer("pointerdown");
  await pointer("pointerdown", { pointerId: 2, isPrimary: false });
  await pointer("pointerup");
  assert.equal(
    await menu.count(),
    0,
    "A second finger cancels the pending tap",
  );
  await type.tap();
  await menu.waitFor();
  await type.press("Escape");

  // Keyboard navigation does not submit the form or dismiss the parent dialog.
  const status = page.locator("#status");
  await status.focus();
  await status.press("ArrowDown");
  await menu.waitFor();
  await status.press("r");
  const active = await status.getAttribute("aria-activedescendant");
  assert.match(await page.locator(`#${active}`).textContent(), /^r/i);
  await status.press("Enter");
  assert.equal(await page.locator("#bookDialog").isVisible(), true);
  await status.press("Space");
  await menu.waitFor();
  await status.press("End");
  const last = await menu.getByRole("option").last().textContent();
  await status.press("Tab");
  assert.equal(await menu.count(), 0);
  assert.equal(await status.locator("option:checked").textContent(), last);
  assert.notEqual(
    await page.evaluate(() => document.activeElement?.id),
    "status",
  );

  // Editable suggestions use the same menu, without restricting free text.
  await page.locator("#sourceOptions").evaluate((list) => {
    list.append(new Option("UI ร้านหนังสือ & Books", "UI ร้านหนังสือ & Books"));
    list.append(new Option("UI Another store", "UI Another store"));
  });
  const source = page.locator("#source");
  assert.equal(await source.getAttribute("list"), null);
  assert.equal(await source.getAttribute("role"), "combobox");
  assert.equal(await source.getAttribute("autocomplete"), "off");
  await source.fill("UI");
  await menu.waitFor();
  assert.equal(await menu.getByRole("option").count(), 2);
  await source.press("ArrowDown");
  await source.press("Enter");
  assert.equal(await source.inputValue(), "UI ร้านหนังสือ & Books");
  assert.equal(await menu.count(), 0);
  await source.fill("UI");
  await menu.waitFor();
  await source.press("Escape");
  assert.equal(await menu.count(), 0);
  assert.equal(await page.locator("#bookDialog").isVisible(), true);
  await source.fill("Any new shop name");
  assert.equal(await menu.count(), 0);
  assert.equal(await source.inputValue(), "Any new shop name");

  if ((await page.locator("#priceCalculator").getAttribute("open")) === null)
    await page.locator("#priceCalculator > summary").click();
  await open(page.locator("#discountType"));
  await menu.getByRole("option", { name: "Amount off", exact: true }).click();
  assert.equal(await page.locator("#discountType").inputValue(), "amount");

  await open(type);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#bookDialog").isVisible(), true);
  await open(type);
  await page.locator("#bookDialog .dialog-head h2").click();
  assert.equal(await menu.count(), 0);
  const closeIcon = await page.locator("#closeBook").evaluate((button) => {
    const box = button.getBoundingClientRect();
    const icon = button.querySelector("svg").getBoundingClientRect();
    return {
      x: Math.abs(box.x + box.width / 2 - icon.x - icon.width / 2),
      y: Math.abs(box.y + box.height / 2 - icon.y - icon.height / 2),
    };
  });
  assert.ok(closeIcon.x < 1 && closeIcon.y < 1);
  await open(type);
  await page.screenshot({
    path: join(process.cwd(), "outputs", "controls-phone.png"),
  });
  await page.keyboard.press("Escape");
  await page.locator("#cancelBook").click();

  // Newly created controls, option mutations, disabled choices and form values.
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.id = "dropdownFixture";
    form.innerHTML = `<label for="dynamicDropdown">Dynamic choices</label>
      <select id="dynamicDropdown" name="choice">
        <option value="first">First</option>
        <optgroup label="More choices">
          <option value="disabled" disabled>Disabled</option>
          <option value="hidden" hidden>Hidden</option>
          <option value="last">Last</option>
        </optgroup>
      </select>`;
    document.querySelector("main").prepend(form);
    window.dropdownChanges = 0;
    form.addEventListener("change", () => window.dropdownChanges++);
  });
  const dynamic = page.locator("#dynamicDropdown");
  await open(dynamic);
  assert.equal(await menu.getByRole("option").count(), 3);
  await dynamic.press("ArrowDown");
  const enabled = await dynamic.getAttribute("aria-activedescendant");
  assert.equal(await page.locator(`#${enabled}`).textContent(), "Last");
  await menu
    .getByRole("option", { name: "Disabled", exact: true })
    .click({ force: true });
  assert.equal(await dynamic.inputValue(), "first");
  await dynamic.evaluate((control) => control.add(new Option("Newest", "new")));
  await menu.getByRole("option", { name: "Newest", exact: true }).waitFor();
  await menu.getByRole("option", { name: "Newest", exact: true }).click();
  assert.equal(await dynamic.inputValue(), "new");
  assert.equal(await page.evaluate(() => window.dropdownChanges), 1);
  assert.equal(
    await page
      .locator("#dropdownFixture")
      .evaluate((form) => new FormData(form).get("choice")),
    "new",
  );
  await dynamic.evaluate((control) => {
    control.value = "last";
  });
  await open(dynamic);
  assert.equal(
    await menu.locator('[aria-selected="true"]').textContent(),
    "Last",
  );
  await dynamic.evaluate((control) => {
    control.disabled = true;
  });
  await menu.waitFor({ state: "detached" });
  await page.locator("#dropdownFixture").evaluate((form) => form.remove());

  // React-controlled preferences use the same menu and still save normally.
  await page.goto(testUrl + "/data");
  await page.waitForLoadState("networkidle");
  const appearance = page.getByRole("combobox", {
    name: "Appearance",
    exact: true,
  });
  await open(appearance);
  await menu.getByRole("option", { name: "Dark", exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await open(appearance);
  assert.equal(
    await menu.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(34, 38, 48)",
  );
  await menu
    .getByRole("option", { name: "Use device setting", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.theme ===
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  assert.equal(
    (await (await page.request.get(testUrl + "/api/preferences")).json()).theme,
    "system",
  );

  await page.goto(testUrl + "/discover");
  await ready();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const category = page.locator("#discoveryPreset");
  const refresh = page.locator("#refreshDiscovery");
  assert.equal(
    (await category.boundingBox()).height,
    (await refresh.boundingBox()).height,
  );
  await open(category);
  await page.screenshot({
    path: join(process.cwd(), "outputs", "controls-desktop.png"),
  });
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    "PASS styled dropdowns on every route, phone/desktop alignment, touch, keyboard, dialog layering, dynamic options, forms and preferences",
  );
} finally {
  await browser.close();
}
