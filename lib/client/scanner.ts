import { canonicalIsbn as canonical } from "../domain/isbn.ts";
import { barcodeRegions, barcodeRetry } from "./scanner-image.ts";

type ScannerBindings = {
  state: ScannerState;
  $: <K extends keyof LibraryElements>(id: K) => LibraryElements[K];
  node: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string | number,
  ) => HTMLElementTagNameMap[K];
  checkBook: () => Promise<void>;
  lookup: () => Promise<void>;
  clearLookup: () => void;
};
export type ScannerState = {
  scanGeneration: number;
  cameraTimer: ReturnType<typeof setTimeout> | null;
  cameraStream: MediaStream | null;
  cameraStart: Promise<MediaStream> | null;
  cameraRunning: boolean;
  photoTask: PhotoTask | null;
  scanPurpose: string;
};

export function printedIsbns(text) {
  const normalized = String(text).replace(/[\u2010-\u2015\u2212]/g, "-"),
    found = new Set();
  // Keep separate OCR lines separate and only accept complete, checksum-valid numbers.
  for (const line of normalized.split(/\r?\n/)) {
    for (const match of line.matchAll(/\b97[89](?:[ \t-]*\d){10}\b/g)) {
      const isbn = canonical(match[0]);
      if (isbn) found.add(isbn);
    }
    for (const match of line.matchAll(
      /\bISBN(?:-10)?[ \t:]*((?:\d[ \t-]*){9}[\dX])\b/gi,
    )) {
      const isbn = canonical(match[1]);
      if (isbn) found.add(isbn);
    }
  }
  return [...found];
}

export async function focusCamera(track: MediaStreamTrack) {
  try {
    const capabilities =
      track?.getCapabilities?.() as MediaTrackCapabilities & {
        focusMode?: string[];
      };
    if (capabilities?.focusMode?.includes("continuous"))
      await track.applyConstraints({
        advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
      });
  } catch {
    // Optional camera controls are not supported consistently across browsers.
  }
}

export function createScanner({
  state,
  $,
  node,
  checkBook,
  lookup,
  clearLookup,
}: ScannerBindings) {
  // Match the server's ISBN rules before accepting a camera result.
  const scannerScripts = new Map();
  function loadScannerScript(url) {
    if (!scannerScripts.has(url))
      scannerScripts.set(
        url,
        new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = url;
          const timer = setTimeout(() => {
            script.remove();
            scannerScripts.delete(url);
            reject(
              new Error(
                "The photo reader could not load. Check your connection or type the ISBN.",
              ),
            );
          }, 20000);
          script.onload = () => {
            clearTimeout(timer);
            resolve();
          };
          script.onerror = () => {
            clearTimeout(timer);
            script.remove();
            scannerScripts.delete(url);
            reject(
              new Error(
                "The photo reader could not load. Check your connection or type the ISBN.",
              ),
            );
          };
          document.head.append(script);
        }),
      );
    return scannerScripts.get(url);
  }
  function scanActive(generation) {
    return generation === state.scanGeneration && $("scanDialog").open;
  }
  function requireScan(generation) {
    if (!scanActive(generation))
      throw new DOMException("Scan cancelled", "AbortError");
  }
  function stopScanner() {
    state.scanGeneration++;
    clearTimeout(state.cameraTimer);
    state.cameraTimer = null;
    state.cameraStream?.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
    const video = $("scannerArea").querySelector("video");
    if (video) {
      video.pause();
      video.srcObject = null;
      video.remove();
    }
    state.cameraRunning = false;
    state.cameraStart = null;
    const task = state.photoTask;
    state.photoTask = null;
    task?.cancel();
    if (task?.worker) {
      void task.worker.terminate().catch(() => {});
      task.worker = null;
    }
    $("startCamera").disabled = false;
    $("stopCamera").hidden = true;
    $("startCamera").hidden = false;
    $("scanCandidates").hidden = true;
    $("scanCandidates").replaceChildren();
  }
  function closeScanner() {
    stopScanner();
    $("scanDialog").close();
  }
  function openScanner(purpose) {
    stopScanner();
    $("scannerArea").replaceChildren();
    state.scanPurpose = purpose;
    $("scanTitle").textContent =
      purpose === "check"
        ? "Check a bookstore book"
        : purpose === "link"
          ? "Scan the ISBN for this volume"
          : "Scan a book";
    $("scanMessage").textContent =
      "Take or choose a photo including the barcode and printed ISBN. Photos stay on your device.";
    $("scanDialog").showModal();
  }
  async function acceptScan(raw, generation) {
    if (!scanActive(generation)) return;
    const isbn = canonical(raw);
    if (!isbn) {
      $("scanMessage").textContent =
        "This barcode is not an ISBN. Take a photo that also includes the printed ISBN.";
      return;
    }
    $("scanMessage").textContent = "ISBN found: " + isbn;
    const purpose = state.scanPurpose;
    closeScanner();
    if (purpose === "check") {
      if (!$("checkDialog").open) return;
      $("checkIsbn").value = isbn;
      await checkBook();
    } else if (purpose === "link") {
      if (!$("isbnDialog").open) return;
      $("linkIsbn").value = isbn;
      $("isbnError").hidden = true;
      $("saveIsbnButton").focus();
    } else {
      if (!$("bookDialog").open) return;
      $("isbn").value = isbn;
      clearLookup();
      await lookup();
    }
  }
  function reviewScan(isbns, generation, printed = false) {
    requireScan(generation);
    const choices = $("scanCandidates");
    choices.replaceChildren();
    choices.hidden = false;
    $("scanMessage").textContent = printed
      ? "Printed ISBN found. Check these digits against the cover, then choose Use ISBN."
      : "Several ISBNs found. Choose the one for this book.";
    isbns.forEach((isbn) => {
      const button = node("button", "btn primary", "Use ISBN " + isbn);
      button.type = "button";
      button.addEventListener("click", () => void acceptScan(isbn, generation));
      choices.append(button);
    });
  }
  function photoCanvas(image, maxSide = 2200) {
    const width = image.naturalWidth || image.videoWidth || image.width,
      height = image.naturalHeight || image.videoHeight || image.height;
    const scale = Math.min(1, maxSide / Math.max(width, height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  async function readBarcodes(canvas, generation, liveAttempt?: number) {
    if (typeof ZXingWASM === "undefined")
      await loadScannerScript(
        "https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.5/dist/iife/reader/index.js",
      );
    requireScan(generation);
    const decode = (image: ImageData) =>
      ZXingWASM.readBarcodes(image, {
        formats: ["EAN13"] as const,
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        minLineCount: 2,
        maxNumberOfSymbols: 8,
      });
    const results = await decode(
      canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height),
    );
    requireScan(generation);
    if (results.some((result) => canonical(result.text))) return results;
    // Live scanning rotates through one retry per frame to keep the camera responsive.
    const attempts =
      liveAttempt === undefined
        ? barcodeRegions.map((_, index) => index)
        : [liveAttempt];
    for (const attempt of attempts) {
      requireScan(generation);
      const retry = await decode(barcodeRetry(canvas, attempt));
      requireScan(generation);
      results.push(...retry);
      if (retry.some((result) => canonical(result.text))) break;
    }
    return results;
  }

  function createPhotoTask(): PhotoTask {
    const task: PhotoTask = { worker: null };
    task.cancelled = new Promise((resolve) => {
      task.cancel = resolve;
    });
    return task;
  }

  function photoStep<T>(promise: Promise<T>, task: PhotoTask): Promise<T> {
    return Promise.race([
      promise,
      task.cancelled.then(() => {
        throw new DOMException("Scan cancelled", "AbortError");
      }),
    ]);
  }
  async function readPrintedIsbns(canvas, generation, task) {
    $("scanMessage").textContent =
      "Looking for the printed ISBN… The first text scan may take a moment.";
    if (typeof Tesseract === "undefined")
      await photoStep(
        loadScannerScript(
          "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js",
        ),
        task,
      );
    requireScan(generation);
    const worker = await photoStep(
      Tesseract.createWorker("eng", 1, {
        workerPath:
          "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",
        corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0",
        langPath:
          "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
      }).then((worker) => {
        if (!scanActive(generation)) {
          void worker.terminate().catch(() => {});
          throw new DOMException("Scan cancelled", "AbortError");
        }
        task.worker = worker;
        return worker;
      }),
      task,
    );
    try {
      requireScan(generation);
      await photoStep(
        worker.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
        }),
        task,
      );
      // Tesseract consumes the same oriented, bounded canvas as the barcode reader.
      const result = await photoStep(worker.recognize(canvas), task);
      requireScan(generation);
      const found = printedIsbns(result.data.text);
      if (found.length) return found;
      // Small text beside decorative barcodes can be missed in a whole-cover layout.
      // Overlapping, enlarged regions preserve context without exceeding phone canvas limits.
      for (const [left, top] of [
        [0, 0],
        [0.35, 0],
        [0, 0.35],
        [0.35, 0.35],
      ]) {
        requireScan(generation);
        const region = document.createElement("canvas"),
          width = canvas.width * 0.65,
          height = canvas.height * 0.65,
          scale = 2200 / Math.max(width, height);
        region.width = Math.round(width * scale);
        region.height = Math.round(height * scale);
        const context = region.getContext("2d");
        context.drawImage(
          canvas,
          left * canvas.width,
          top * canvas.height,
          width,
          height,
          0,
          0,
          region.width,
          region.height,
        );
        try {
          const result = await photoStep(worker.recognize(region), task);
          requireScan(generation);
          const found = printedIsbns(result.data.text);
          if (found.length) return found;
        } finally {
          region.width = region.height = 1;
        }
      }
      return [];
    } finally {
      if (task.worker === worker) {
        task.worker = null;
        await worker.terminate();
      }
    }
  }
  async function startCamera() {
    if (state.cameraStart || state.cameraRunning) return;
    stopScanner();
    $("scannerArea").replaceChildren();
    const generation = state.scanGeneration;
    if (!navigator.mediaDevices?.getUserMedia) {
      $("scanMessage").textContent =
        "Live camera access is unavailable here. Use Take photo or Choose photo.";
      return;
    }
    $("scanMessage").textContent =
      "Allow camera access, then hold the ISBN barcode steady.";
    $("startCamera").disabled = true;
    // Request permission directly from the button gesture, before any library loading.
    let pending, stream;
    try {
      pending = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      state.cameraStart = pending;
      stream = await pending;
      if (!scanActive(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      state.cameraStream = stream;
      // Focus is optional; a rejected camera control must not prevent playback.
      void focusCamera(stream.getVideoTracks?.()[0]);
      const video = node("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.srcObject = stream;
      video.style.cssText =
        "display:block;width:100%;max-height:45dvh;object-fit:contain";
      $("scannerArea").replaceChildren(video);
      let playTimer;
      try {
        await Promise.race([
          video.play(),
          new Promise((_, reject) => {
            playTimer = setTimeout(
              () =>
                reject(
                  new DOMException(
                    "Camera video did not start",
                    "TimeoutError",
                  ),
                ),
              8000,
            );
          }),
        ]);
      } finally {
        clearTimeout(playTimer);
      }
      requireScan(generation);
      state.cameraRunning = true;
      $("startCamera").hidden = true;
      $("stopCamera").hidden = false;
      $("scanMessage").textContent =
        "Hold the barcode and printed ISBN steady. If the bars are unclear, the camera will try the printed digits too.";
      let liveAttempt = 0,
        nextTextScan = performance.now() + 3000;
      const frame = async () => {
        if (!scanActive(generation) || !state.cameraRunning) return;
        try {
          if (video.readyState >= 2) {
            const canvas = photoCanvas(video);
            try {
              const results = await readBarcodes(
                canvas,
                generation,
                liveAttempt++,
              );
              if (!scanActive(generation)) return;
              const isbns = [
                ...new Set(
                  results
                    .map((result) => canonical(result.text))
                    .filter(Boolean),
                ),
              ];
              if (isbns.length === 1) {
                await acceptScan(isbns[0], generation);
                return;
              }
              if (isbns.length > 1) {
                reviewScan(isbns, generation);
                return;
              }
              if (performance.now() >= nextTextScan) {
                const task = createPhotoTask();
                state.photoTask = task;
                try {
                  const printed = await readPrintedIsbns(
                    canvas,
                    generation,
                    task,
                  );
                  requireScan(generation);
                  if (printed.length) {
                    reviewScan(printed, generation, true);
                    return;
                  }
                } catch {
                  // Keep barcode scanning available when text reading cannot load.
                  if (!scanActive(generation)) return;
                } finally {
                  if (state.photoTask === task) state.photoTask = null;
                  nextTextScan = performance.now() + 15000;
                }
                $("scanMessage").textContent =
                  "Still scanning. Keep the whole barcode in view, avoid glare, or take a closer photo including the printed ISBN.";
              }
            } finally {
              canvas.width = canvas.height = 1;
            }
          }
        } catch (error) {
          if (scanActive(generation)) {
            stopScanner();
            $("scanMessage").textContent =
              error.message ||
              "The camera reader is unavailable. Use Take photo or type the ISBN.";
          }
          return;
        }
        if (scanActive(generation)) state.cameraTimer = setTimeout(frame, 250);
      };
      void frame();
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (scanActive(generation)) {
        stopScanner();
        $("scanMessage").textContent =
          error.name === "NotAllowedError"
            ? "Live camera access was blocked by the browser or this embedded page. Use Take photo or Choose photo."
            : "The live camera could not start. Use Take photo or Choose photo, or open the app in Safari.";
      }
    } finally {
      if (state.cameraStart === pending) state.cameraStart = null;
      if (scanActive(generation)) $("startCamera").disabled = false;
    }
  }
  async function scanPhoto(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    stopScanner();
    const generation = state.scanGeneration,
      task = createPhotoTask();
    state.photoTask = task;
    $("scannerArea").replaceChildren();
    $("scanMessage").textContent = "Reading the barcode in your photo…";
    const url = URL.createObjectURL(file),
      image = new Image();
    let canvas;
    try {
      image.src = url;
      await photoStep(image.decode(), task);
      requireScan(generation);
      canvas = photoCanvas(image);
      image.removeAttribute("src");
      URL.revokeObjectURL(url);
      const preview = photoCanvas(canvas, 650);
      preview.style.cssText =
        "display:block;width:100%;max-height:38dvh;object-fit:contain";
      $("scannerArea").replaceChildren(preview);
      const results = await readBarcodes(canvas, generation);
      requireScan(generation);
      const isbns = [
        ...new Set(
          results.map((result) => canonical(result.text)).filter(Boolean),
        ),
      ];
      if (isbns.length === 1) {
        await acceptScan(isbns[0], generation);
        return;
      }
      if (isbns.length > 1) {
        reviewScan(isbns, generation);
        return;
      }
      const printed = await readPrintedIsbns(canvas, generation, task);
      requireScan(generation);
      if (printed.length) {
        reviewScan(printed, generation, true);
        return;
      }
      $("scanMessage").textContent = results.length
        ? "The barcode is a shop code, and the printed ISBN could not be read. Retake a closer photo including the ISBN above the barcode, or type it."
        : "Could not read an ISBN from this photo. Retake a closer, sharp photo including the barcode and printed ISBN, or type it.";
    } catch (error) {
      if (scanActive(generation))
        $("scanMessage").textContent =
          error.name === "EncodingError"
            ? "This photo format could not be opened. Choose a JPEG or PNG photo, or type the ISBN."
            : error.message ||
              "The photo reader could not finish. Try again or type the ISBN.";
    } finally {
      URL.revokeObjectURL(url);
      image.removeAttribute("src");
      if (canvas) canvas.width = canvas.height = 1;
      if (state.photoTask === task) state.photoTask = null;
    }
  }

  return {
    openScanner,
    closeScanner,
    startCamera,
    stopScanner,
    scanPhoto,
    readPrintedIsbns,
  };
}
