// Standalone browser audit: no production server, database, or external network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { chromium } from "playwright";
import { parseImport } from "../../lib/server/importer.ts";
import { textHtml } from "../../lib/domain/html.ts";

const root = new URL("../../", import.meta.url);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      '<!doctype html><html lang="en"><head></head><body></body></html>',
    );
    return;
  }
  if (!/^\/lib\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.ts$/.test(path)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const source = await readFile(new URL(path.slice(1), root), "utf8");
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(
      ts.transpileModule(source, {
        fileName: fileURLToPath(new URL(path.slice(1), root)),
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    );
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BOOKS_BROWSER_EXECUTABLE
      ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  // Any unanticipated external requests fail closed rather than reaching a CDN.
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  const ocrUrl =
    "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";
  let ocrRequests = 0;
  await page.route(ocrUrl, (route) => {
    ocrRequests++;
    return route.fulfill({
      contentType: "text/javascript",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: `globalThis.__scannerCompromised = true;
        globalThis.Tesseract = { PSM: { SPARSE_TEXT: 11 }, createWorker: async () => ({
          setParameters: async () => {},
          recognize: async () => ({ data: { text: "ISBN 9786166147353" } }),
          terminate: async () => {}
        }) };`,
    });
  });
  await page.goto(origin);
  const tampered = await page.evaluate(async () => {
    const { createScanner } = await import("/lib/client/scanner.ts");
    const elements = new Map();
    const element = (id) => {
      if (!elements.has(id)) elements.set(id, { open: true });
      return elements.get(id);
    };
    const scanner = createScanner({
      state: { scanGeneration: 0 },
      $: element,
    });
    const task = { cancelled: new Promise(() => {}) };
    let error = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await scanner.readPrintedIsbns({}, 0, task);
      } catch (cause) {
        error = cause.message;
      }
    }
    return { compromised: !!globalThis.__scannerCompromised, error };
  });
  assert.equal(
    tampered.compromised,
    false,
    "Altered CDN code must not execute",
  );
  assert.match(tampered.error, /photo reader could not load/);
  assert.equal(ocrRequests, 2, "A rejected download must remain retryable");

  const barcodeUrl =
    "https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.5/dist/iife/reader/index.js";
  await page.route(barcodeUrl, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: `globalThis.__scannerCompromised = true;
        globalThis.ZXingWASM = { readBarcodes: async () => [{ text: "9786166147353" }] };`,
    }),
  );
  const barcode = await page.evaluate(async () => {
    const { createScanner } = await import("/lib/client/scanner.ts");
    const elements = new Map();
    const element = (id) => {
      if (!elements.has(id)) {
        const control = document.createElement(
          id.endsWith("Dialog") ? "dialog" : "div",
        );
        if (id === "scanDialog") control.open = true;
        elements.set(id, control);
      }
      return elements.get(id);
    };
    const scanner = createScanner({
      state: { scanGeneration: 0, scanPurpose: "check" },
      $: element,
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    await scanner.scanPhoto({
      target: {
        files: [new File([blob], "cover.png", { type: "image/png" })],
        value: "",
      },
    });
    return {
      compromised: !!globalThis.__scannerCompromised,
      message: element("scanMessage").textContent,
    };
  });
  assert.equal(
    barcode.compromised,
    false,
    "Altered barcode code must not execute",
  );
  assert.match(barcode.message, /photo reader could not load/);
  console.log(
    "PASS altered CDN barcode/OCR scripts fail integrity verification and can retry",
  );

  const payload =
    '</script><img src=x onerror="globalThis.__xss=1"><svg onload="globalThis.__xss=1">';
  const imported = parseImport(
    Buffer.from(
      JSON.stringify([{ series: payload, publisher: payload, note: payload }]),
    ),
    "untrusted.json",
  );
  const strings = [
    ...Object.values(imported.books[0]).filter(
      (value) => typeof value === "string",
    ),
    textHtml("&lt;img src=x onerror=globalThis.__xss=1&gt;"),
  ];
  const rendered = await page.evaluate(async (strings) => {
    const { node } = await import("/lib/client/dom.ts");
    const container = node("div");
    for (const value of strings) container.append(node("span", "", value));
    document.body.append(container);
    return {
      strings: [...container.children].map((child) => child.textContent),
      injected: container.querySelectorAll("script,img,svg,[onerror],[onload]")
        .length,
      executed: !!globalThis.__xss,
    };
  }, strings);
  assert.deepEqual(rendered.strings, strings);
  assert.equal(rendered.injected, 0);
  assert.equal(rendered.executed, false);
  console.log(
    "PASS imported and HTML-decoded book strings remain text in DOM sinks",
  );
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
