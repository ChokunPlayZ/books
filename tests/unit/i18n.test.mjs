import test from "node:test";
import assert from "node:assert/strict";
import { translator } from "../../lib/i18n.ts";
import { thai } from "../../lib/locales/th.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

test("Thai and English translations preserve interpolation and unknown text", () => {
  const th = translator("th"),
    en = translator("en");
  assert.equal(th("Your collection"), "คลังหนังสือของคุณ");
  assert.equal(en("Your collection"), "Your collection");
  assert.equal(th("Volume {volume}", { volume: 4.5 }), "เล่ม 4.5");
  assert.equal(th("A custom title"), "A custom title");
  assert.equal(th("toString"), "toString");
  for (const [source, translated] of Object.entries(thai)) {
    assert.ok(translated.trim(), source);
    assert.deepEqual(
      [...source.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
      [...translated.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
      source,
    );
  }
});

test("meemai branding uses the original Thai name in the Thai interface", () => {
  assert.equal(translator("en")("meemai"), "meemai");
  assert.equal(translator("th")("meemai"), "มีมั้ย");
  assert.equal(translator("en")("meemai home"), "meemai home");
  assert.equal(translator("th")("meemai home"), "หน้าหลักมีมั้ย");
});

test("every explicitly translated interface literal has a Thai translation", () => {
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        scan(path);
        continue;
      }
      if (!/\.tsx?$/.test(path)) continue;
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      function message(node) {
        if (ts.isStringLiteral(node) && /[A-Za-z]/.test(node.text))
          assert.ok(Object.hasOwn(thai, node.text), `${path}: ${node.text}`);
        else if (ts.isConditionalExpression(node)) {
          message(node.whenTrue);
          message(node.whenFalse);
        }
      }
      function visit(node) {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === "t" &&
          node.arguments[0]
        )
          message(node.arguments[0]);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan(fileURLToPath(new URL("../../components", import.meta.url)));
  scan(fileURLToPath(new URL("../../lib/client", import.meta.url)));
});
