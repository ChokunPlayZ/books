import test from "node:test";
import assert from "node:assert/strict";
import {
  createScanner,
  focusCamera,
  printedIsbns,
} from "../../lib/client/scanner.ts";
import { enhanceBarcode } from "../../lib/client/scanner-image.ts";

function scannerHarness(t, extra = {}) {
  for (const [name, value] of Object.entries({ navigator: {}, ...extra })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, name, previous)
        : delete globalThis[name],
    );
  }
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        open: true,
        hidden: false,
        disabled: false,
        textContent: "",
        replaceChildren() {},
        querySelector() {
          return null;
        },
      });
    return elements.get(id);
  };
  const state = {
    scanGeneration: 0,
    cameraStart: null,
    cameraRunning: false,
    cameraStream: null,
    cameraTimer: null,
    photoTask: null,
  };
  const scanner = createScanner({
    state,
    $: element,
    checkBook: async () => {},
    lookup: async () => {},
    clearLookup() {},
  });
  return { state, element, ...scanner };
}

test("printed ISBN recognition handles punctuation and rejects shop codes and bad checksums", () => {
  assert.deepEqual(printedIsbns("ISBN 978–616—614—735-3"), ["9786166147353"]);
  assert.deepEqual(printedIsbns("978-616—-614—-735-3"), ["9786166147353"]);
  assert.deepEqual(printedIsbns("ISBN 978-616-489-468-6\n9786164894686"), [
    "9786164894686",
  ]);
  assert.deepEqual(printedIsbns("ISBN-10: 0-8044-2957-X"), ["9780804429573"]);
  for (const text of [
    "3032504880045",
    "9786166147354",
    "97861648946860",
    "19786164894686",
    "978-616-\n614-735-3",
    "ISBN 978-O16-489-468-6",
  ])
    assert.deepEqual(printedIsbns(text), [], text);
});

test("barcode enhancement increases faint bar contrast and preserves transparency", () => {
  const data = new Uint8ClampedArray(
    [110, 110, 130, 130, 110, 110, 130, 130].flatMap((value) => [
      value,
      value,
      value,
      200,
    ]),
  );
  enhanceBarcode({ width: 8, height: 1, data });
  assert.ok(data[2 * 4] - data[1 * 4] > 100);
  assert.equal(data[0], data[1]);
  assert.equal(data[1], data[2]);
  assert.equal(data[3], 200);
  assert.equal(data[7 * 4 + 3], 200);
});

test("continuous camera focus is requested only when supported and is optional", async () => {
  const requests = [];
  await focusCamera({
    getCapabilities: () => ({ focusMode: ["manual", "continuous"] }),
    applyConstraints: async (constraints) => requests.push(constraints),
  });
  assert.deepEqual(requests, [{ advanced: [{ focusMode: "continuous" }] }]);
  await focusCamera({
    getCapabilities: () => ({ focusMode: ["manual"] }),
    applyConstraints: async (constraints) => requests.push(constraints),
  });
  assert.equal(requests.length, 1, "Unsupported focus must not be requested");
  await focusCamera({});
  await focusCamera({
    getCapabilities: () => ({ focusMode: ["continuous"] }),
    applyConstraints: async () => {
      throw new DOMException("Unsupported", "OverconstrainedError");
    },
  });
});

test("closing scanner stops camera tracks and cancels photo work without waiting for permission", (t) => {
  const h = scannerHarness(t);
  let stopped = 0,
    cancelled = 0,
    terminated = 0;
  h.state.cameraStart = new Promise(() => {});
  h.state.cameraRunning = true;
  h.state.cameraStream = {
    getTracks: () => [
      {
        stop() {
          stopped++;
        },
      },
    ],
  };
  h.state.photoTask = {
    cancel() {
      cancelled++;
    },
    worker: {
      terminate() {
        terminated++;
        return Promise.resolve();
      },
    },
  };
  h.stopScanner();
  assert.equal(stopped, 1);
  assert.equal(cancelled, 1);
  assert.equal(terminated, 1);
  assert.equal(h.state.cameraStart, null);
  assert.equal(h.state.cameraRunning, false);
  assert.equal(h.state.photoTask, null);
  assert.equal(h.state.scanGeneration, 1);
  assert.equal(h.element("startCamera").disabled, false);
});

test("permission denial and synchronous camera errors leave photo controls available", async (t) => {
  for (const synchronous of [false, true]) {
    const error = new DOMException("Denied", "NotAllowedError");
    const h = scannerHarness(t, {
      navigator: {
        mediaDevices: {
          getUserMedia() {
            if (synchronous) throw error;
            return Promise.reject(error);
          },
        },
      },
    });
    await h.startCamera();
    assert.match(h.element("scanMessage").textContent, /blocked.*Take photo/);
    assert.equal(h.element("startCamera").disabled, false);
    assert.equal(h.state.cameraRunning, false);
  }
});

test("permission granted after scanner closes cannot restart the camera", async (t) => {
  let allow,
    stopped = 0;
  const h = scannerHarness(t, {
    navigator: {
      mediaDevices: {
        getUserMedia: () =>
          new Promise((resolve) => {
            allow = resolve;
          }),
      },
    },
  });
  const starting = h.startCamera();
  h.stopScanner();
  h.element("scanDialog").open = false;
  allow({
    getTracks: () => [
      {
        stop() {
          stopped++;
        },
      },
    ],
  });
  await starting;
  assert.equal(stopped, 1);
  assert.equal(h.state.cameraRunning, false);
  assert.equal(h.state.cameraStream, null);
});

test("cancelling a text scan releases an unresponsive OCR job", async (t) => {
  let recognizeStarted,
    terminated = 0;
  const started = new Promise((resolve) => {
    recognizeStarted = resolve;
  });
  const worker = {
    setParameters: async () => {},
    recognize() {
      recognizeStarted();
      return new Promise(() => {});
    },
    terminate: async () => {
      terminated++;
    },
  };
  const h = scannerHarness(t, {
    Tesseract: { PSM: { SPARSE_TEXT: 11 }, createWorker: async () => worker },
  });
  const task = { worker: null };
  task.cancelled = new Promise((resolve) => (task.cancel = resolve));
  h.state.photoTask = task;
  const reading = h.readPrintedIsbns({}, 0, task);
  await started;
  h.stopScanner();
  await assert.rejects(reading, (error) => error.name === "AbortError");
  assert.equal(terminated, 1);
});
