import test from "node:test";
import assert from "node:assert/strict";
import { selectRange } from "../../lib/client/selection.ts";

test("modifier selection toggles individual rows and Shift uses the filtered order", () => {
  const order = ["d", "b", "a", "c"];
  let selected = selectRange(order, new Set(), null, "b", { additive: true });
  selected = selectRange(order, selected, "b", "d", { additive: true });
  assert.deepEqual([...selected], ["b", "d"]);
  assert.deepEqual(
    [...selectRange(order, selected, "b", "b", { additive: true })],
    ["d"],
  );
  assert.deepEqual(
    [...selectRange(order, selected, "b", "c", { range: true })],
    ["b", "a", "c"],
  );
  assert.deepEqual(
    [
      ...selectRange(order, selected, "b", "c", {
        range: true,
        additive: true,
      }),
    ],
    ["b", "d", "a", "c"],
  );
  assert.deepEqual(
    [...selectRange(order, selected, "missing", "a", { range: true })],
    ["a"],
  );
});

test("ranges include unloaded rows and work in both directions", () => {
  const order = Array.from({ length: 200 }, (_, i) => String(i));
  assert.equal(
    selectRange(order, new Set(), "10", "150", { range: true }).size,
    141,
  );
  assert.deepEqual(
    [...selectRange(order, new Set(), "3", "1", { range: true })],
    ["1", "2", "3"],
  );
});
