// Retry at different scales without discarding the original camera pixels.
export const barcodeRegions = [
  [0, 0, 1],
  [0.15, 0.15, 0.7],
  [0, 0, 0.65],
  [0.35, 0, 0.65],
  [0, 0.35, 0.65],
  [0.35, 0.35, 0.65],
] as const;

export function enhanceBarcode(image: ImageData) {
  const { data, width, height } = image,
    gray = new Uint8ClampedArray(width * height),
    histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;
    gray[i] =
      (data[offset] * 77 + data[offset + 1] * 150 + data[offset + 2] * 29) >> 8;
    histogram[gray[i]]++;
  }
  // Ignore extreme pixels so glare and dark surroundings do not set the range.
  const margin = gray.length * 0.02;
  let low = 0,
    high = 255,
    count = 0;
  while (low < 255 && count + histogram[low] <= margin)
    count += histogram[low++];
  count = 0;
  while (high > low && count + histogram[high] <= margin)
    count += histogram[high--];
  const scale = 255 / Math.max(32, high - low);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        // A mild unsharp mask restores soft bar edges without a hard threshold.
        average =
          (gray[y * width + Math.max(0, x - 1)] +
            gray[y * width + Math.min(width - 1, x + 1)] +
            gray[Math.max(0, y - 1) * width + x] +
            gray[Math.min(height - 1, y + 1) * width + x]) /
          4,
        value = (gray[i] + (gray[i] - average) * 1.5 - low) * scale,
        offset = i * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = value;
    }
  }
  return image;
}

export function barcodeRetry(canvas: HTMLCanvasElement, attempt: number) {
  const [left, top, size] = barcodeRegions[attempt % barcodeRegions.length],
    width = canvas.width * size,
    height = canvas.height * size,
    scale = Math.min(2, 2200 / Math.max(width, height)),
    region = document.createElement("canvas");
  region.width = Math.max(1, Math.round(width * scale));
  region.height = Math.max(1, Math.round(height * scale));
  const context = region.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingQuality = "high";
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
    return enhanceBarcode(
      context.getImageData(0, 0, region.width, region.height),
    );
  } finally {
    region.width = region.height = 1;
  }
}
