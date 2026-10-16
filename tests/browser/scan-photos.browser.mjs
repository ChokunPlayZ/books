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
  // Soft, off-center EAN-13 bars with no printed digits: only barcode recovery can pass.
  const digits = "9786168381908",
    left = [
      "0001101",
      "0011001",
      "0010011",
      "0111101",
      "0100011",
      "0110001",
      "0101111",
      "0111011",
      "0110111",
      "0001011",
    ],
    even = [
      "0100111",
      "0110011",
      "0011011",
      "0100001",
      "0011101",
      "0111001",
      "0000101",
      "0010001",
      "0001001",
      "0010111",
    ];
  let pattern = "101";
  for (let i = 1; i < 7; i++)
    pattern += ("LGGLGL"[i - 1] === "L" ? left : even)[Number(digits[i])];
  pattern += "01010";
  for (let i = 7; i < 13; i++)
    pattern += left[Number(digits[i])].replace(/[01]/g, (bit) =>
      bit === "0" ? "1" : "0",
    );
  pattern += "101";
  for (const unit of [2, 3]) {
    await page.locator("#checkScanButton").click();
    const { photo, original } = await page.evaluate(
      async ({ pattern, unit }) => {
        const bars = document.createElement("canvas");
        bars.width = 400;
        bars.height = 150;
        const context = bars.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, 400, 150);
        context.fillStyle = "rgb(180,180,180)";
        for (let i = 0; i < pattern.length; i++)
          if (pattern[i] === "1") context.fillRect(30 + i * unit, 25, unit, 90);
        const camera = document.createElement("canvas");
        camera.width = 960;
        camera.height = 540;
        const frame = camera.getContext("2d");
        frame.fillStyle = "#18261e";
        frame.fillRect(0, 0, 960, 540);
        frame.translate(650, 250);
        frame.rotate(0.06);
        frame.filter = "blur(0.6px)";
        frame.drawImage(bars, -200, -75);
        const original = await ZXingWASM.readBarcodes(
          frame.getImageData(0, 0, 960, 540),
          {
            formats: ["EAN13"],
            tryHarder: true,
            tryRotate: true,
            tryInvert: true,
            maxNumberOfSymbols: 8,
          },
        );
        return {
          photo: camera.toDataURL("image/png").split(",")[1],
          original: original.map((result) => result.text),
        };
      },
      { pattern, unit },
    );
    assert.deepEqual(
      original,
      [],
      "Unprocessed soft barcode reproduces failure",
    );
    await page.locator("#chooseBarcodePhoto").setInputFiles({
      name: "soft-barcode.png",
      mimeType: "image/png",
      buffer: Buffer.from(photo, "base64"),
    });
    await page.waitForFunction(
      () => !document.getElementById("scanDialog").open,
      null,
      { timeout: 15000 },
    );
    assert.equal(await page.locator("#checkIsbn").inputValue(), digits);
    console.log("PASS enhanced soft barcode at " + unit + " pixels per bar");
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
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ddd";
    context.fillRect(0, 0, 640, 480);
    context.fillStyle = "#444";
    context.filter = "blur(0.4px)";
    context.font = "24px sans-serif";
    context.fillText("ISBN 978-616-838-190-8", 130, 240);
    // Unreadable bars below a readable printed ISBN reproduce the live-camera case.
    for (let x = 130; x < 450; x += 9) context.fillRect(x, 260, 3, 70);
    window.testCanvas = canvas;
    window.testStream = canvas.captureStream(10);
    window.testPaint = setInterval(() => context.fillRect(0, 0, 1, 1), 100);
    navigator.mediaDevices.getUserMedia = async () => window.testStream;
  });
  await page.locator("#startCamera").click();
  const printedChoice = page.getByRole("button", {
    name: "Use ISBN " + digits,
    exact: true,
  });
  await printedChoice.waitFor({ timeout: 90000 });
  assert.equal(await page.locator("#scanDialog").evaluate((e) => e.open), true);
  await printedChoice.click();
  assert.equal(await page.locator("#checkIsbn").inputValue(), digits);
  assert.equal(
    await page.evaluate(() =>
      testStream.getTracks().every((track) => track.readyState === "ended"),
    ),
    true,
  );
  await page.evaluate(() => clearInterval(testPaint));
  console.log(
    "PASS live camera falls back to printed ISBN and requires review",
  );
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
    window.bookCollection.state.photoTask = {
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
    window.bookCollection.state.photoTask = null;
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
