import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../../app/styles/theme.css", import.meta.url),
  "utf8",
);

function luminance(hex) {
  let value = hex.slice(1);
  if (value.length === 3)
    value = [...value].map((character) => character.repeat(2)).join("");
  const [red, green, blue] = value.match(/../g).map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

test("shared text and control theme tokens meet WCAG AA contrast", () => {
  for (const [index, section] of css
    .split(':root[data-theme="dark"]')
    .entries()) {
    const colors = Object.fromEntries(
      [...section.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{3,6});/g)].map(
        ([, name, value]) => [name, value],
      ),
    );
    for (const [foreground, background] of [
      ["ink", "paper"],
      ["muted", "paper"],
      ["placeholder", "white"],
      ["on-primary", "primary"],
      ["success-ink", "success-background"],
      ["warning-ink", "warning-background"],
      ["error-ink", "error-background"],
    ]) {
      const values = [
        luminance(colors[foreground]),
        luminance(colors[background]),
      ];
      const contrast =
        (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
      assert.ok(
        contrast >= 4.5,
        `${index ? "dark" : "light"}: ${foreground} on ${background} is ${contrast.toFixed(2)}:1`,
      );
    }
  }
});
