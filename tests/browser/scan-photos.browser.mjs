import { testUrl } from "../helpers/browser.mjs";
// Browser scenario against an isolated Next.js test library.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
const { chromium } = await import(
  process.env.BOOKS_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOOKS_BROWSER_EXECUTABLE
    ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
    : {}),
});
const fixtureDir = process.env.BOOKS_SCAN_PHOTO_DIR;
const photos = [
  ["2070", "9786164894686"],
  ["2069", "9786166247275"],
  ["2068", "9786166147353"],
];
const started = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [],
    uploads = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      !new URL(request.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)
    )
      uploads.push(request.url());
  });
  await page.goto(testUrl);
  await page.locator("#checkBookButton").click();
  for (const [number, isbn] of photos) {
    await page.locator("#checkScanButton").click();
    const file = fixtureDir
      ? path.join(fixtureDir, "IMG_" + number + ".JPG")
      : fileURLToPath(
          new URL("../fixtures/img_" + number + ".jpg", import.meta.url),
        );
    await page.locator("#chooseBarcodePhoto").setInputFiles(file);
    try {
      await page.waitForFunction(
        () =>
          !document.getElementById("scanDialog").open ||
          !document.getElementById("scanCandidates").hidden ||
          window.bookCollection?.state.photoTask === null,
        null,
        { timeout: 90000 },
      );
    } catch (error) {
      throw new Error(
        "Photo IMG_" +
          number +
          ": " +
          (await page.locator("#scanMessage").textContent()),
        { cause: error },
      );
    }
    if (
      (await page.locator("#scanDialog").evaluate((e) => e.open)) &&
      (await page.locator("#scanCandidates").evaluate((e) => e.hidden))
    )
      throw new Error(
        "Photo IMG_" +
          number +
          ": " +
          (await page.locator("#scanMessage").textContent()),
      );
    if (number === "2068") {
      assert.equal(
        await page.locator("#scanDialog").evaluate((e) => e.open),
        true,
        "OCR result requires review",
      );
      await page
        .getByRole("button", { name: "Use ISBN " + isbn, exact: true })
        .click();
    }
    await page.waitForFunction(
      () => !document.getElementById("scanDialog").open,
    );
    assert.equal(await page.locator("#checkIsbn").inputValue(), isbn);
    console.log("PASS photo IMG_" + number + " → " + isbn);
  }
  await page.locator("#checkScanButton").click();
  assert.equal(
    await page.locator("#barcodePhoto").getAttribute("capture"),
    "environment",
  );
  assert.equal(
    await page.locator("#chooseBarcodePhoto").getAttribute("capture"),
    null,
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      writable: true,
      value: () =>
        Promise.reject(new DOMException("Denied", "NotAllowedError")),
    });
  });
  await page.locator("#startCamera").click();
  await page.waitForFunction(() =>
    document.getElementById("scanMessage").textContent.includes("blocked"),
  );
  assert.equal(await page.locator("#startCamera").isEnabled(), true);
  console.log("PASS denied camera permits photo fallback");
  await page.locator("#chooseBarcodePhoto").setInputFiles({
    name: "broken.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not an image"),
  });
  await page.waitForFunction(() =>
    document
      .getElementById("scanMessage")
      .textContent.includes("format could not be opened"),
  );
  console.log("PASS unreadable image gives a format error");
  // A real MediaStream from a canvas exercises inline video playback and track cleanup.
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    canvas.getContext("2d").fillRect(0, 0, 640, 480);
    window.testStream = canvas.captureStream(10);
    window.testCanvas = canvas;
    window.testPaint = setInterval(() => {
      canvas.getContext("2d").fillStyle = Date.now() % 2 ? "#111" : "#222";
      canvas.getContext("2d").fillRect(0, 0, 640, 480);
    }, 100);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.testConstraints = constraints;
      return window.testStream;
    };
  });
  await page.locator("#startCamera").click();
  await page.waitForFunction(() => window.bookCollection?.state.cameraRunning);
  assert.equal(
    await page
      .locator("#scannerArea video")
      .evaluate((e) => e.playsInline && e.muted),
    true,
  );
  assert.equal(
    await page.evaluate(() => testConstraints.video.facingMode.ideal),
    "environment",
  );
  await page.locator("#closeScan").click();
  assert.equal(
    await page.evaluate(() =>
      testStream.getTracks().every((track) => track.readyState === "ended"),
    ),
    true,
  );
  await page.evaluate(() => clearInterval(testPaint));
  console.log("PASS live video starts inline and closes its camera tracks");
  await page.locator("#checkScanButton").click();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        window.grantCamera = resolve;
      });
  });
  await page.locator("#startCamera").click();
  await page.locator("#closeScan").click();
  await page.evaluate(() => {
    window.lateStopped = 0;
    grantCamera({
      getTracks: () => [
        {
          stop() {
            window.lateStopped++;
          },
        },
      ],
    });
  });
  await page.waitForFunction(() => window.lateStopped === 1);
  assert.equal(
    await page.evaluate(() => window.bookCollection?.state.cameraRunning),
    false,
  );
  console.log("PASS late camera permission cannot reopen a closed scanner");
  // Backgrounding for the iOS native picker must not invalidate a pending photo decode.
  await page.locator("#checkScanButton").click();
  await page.evaluate(() => {
    window.bookCollection?.state.photoTask = {
      cancel() {
        window.photoCancelled = true;
      },
    };
    window.photoCancelled = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await page.evaluate(() => photoCancelled), false);
  await page.evaluate(() => {
    delete document.hidden;
    window.bookCollection?.state.photoTask = null;
  });
  await page.locator("#closeScan").click();
  console.log(
    "PASS native photo picker backgrounding preserves the photo scan",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(uploads, []);
  console.log(
    "All browser checks passed in " +
      ((Date.now() - started) / 1000).toFixed(1) +
      "s; photos were not uploaded.",
  );
} finally {
  await browser.close();
}
