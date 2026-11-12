import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

export async function checkAdminDialog(page, dialog, capture) {
  await dialog.waitFor();
  assert.equal(
    await dialog.evaluate((element) => element.matches(":modal")),
    true,
    "inspection opens in the browser's modal layer",
  );
  assert.equal(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
    true,
    "focus moves into the popup",
  );
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  await close.focus();
  for (let step = 0; step < 4; step++) {
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await dialog.evaluate(
        (element) =>
          element.contains(document.activeElement) ||
          // Native dialogs may visit browser chrome, represented by body focus.
          document.activeElement === document.body,
      ),
      true,
      "background controls stay outside keyboard navigation",
    );
  }
  const viewport = page.viewportSize();
  const theme = await page.evaluate(
    () => document.documentElement.dataset.theme,
  );
  await mkdir("outputs", { recursive: true });
  for (const [width, appearance] of [
    [1280, "light"],
    [390, "dark"],
    [320, "light"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      appearance,
    );
    assert.equal(
      await dialog.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const body = element.querySelector(".admin-dialog-body");
        return (
          bounds.left >= 0 &&
          bounds.top >= 0 &&
          bounds.right <= innerWidth &&
          bounds.bottom <= innerHeight &&
          element.scrollWidth <= element.clientWidth &&
          body.scrollWidth <= body.clientWidth &&
          document.documentElement.scrollWidth <= innerWidth
        );
      }),
      true,
      `popup contents fit at ${width}px/${appearance}`,
    );
    const body = dialog.locator(".admin-dialog-body");
    await body.evaluate(
      (element) => (element.scrollTop = element.scrollHeight),
    );
    assert.equal(
      await close.evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        return (
          bounds.left >= 0 &&
          bounds.right <= innerWidth &&
          bounds.top >= 0 &&
          bounds.bottom <= innerHeight
        );
      }),
      true,
      "Close remains visible when the popup body scrolls",
    );
    await body.evaluate((element) => (element.scrollTop = 0));
    await page.screenshot({
      path: `outputs/admin-dialog-${capture}-${width}-${appearance}.png`,
      animations: "disabled",
    });
  }
  await page.setViewportSize(viewport);
  await page.evaluate((value) => {
    if (value) document.documentElement.dataset.theme = value;
    else delete document.documentElement.dataset.theme;
  }, theme);
}
