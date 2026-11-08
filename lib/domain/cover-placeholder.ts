import { decode } from "blurhash";

const cache = new Map<string, string>();

// A tiny inline bitmap works in both server-rendered HTML and the DOM controller;
// it needs no canvas, extra network request, or client-side image decoder.
export function coverPlaceholderUrl(hash?: string): string {
  if (!hash || hash.length > 166) return "";
  if (cache.has(hash)) return cache.get(hash)!;
  try {
    const width = 12,
      height = 16;
    const pixels = decode(hash, width, height);
    const bytes = new Uint8Array(54 + width * height * 3);
    const view = new DataView(bytes.buffer);
    bytes.set([0x42, 0x4d]);
    view.setUint32(2, bytes.length, true);
    view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, -height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    view.setUint32(34, bytes.length - 54, true);
    for (let i = 0; i < width * height; i++) {
      bytes[54 + i * 3] = pixels[i * 4 + 2];
      bytes[55 + i * 3] = pixels[i * 4 + 1];
      bytes[56 + i * 3] = pixels[i * 4];
    }
    const url = "data:image/bmp;base64," + btoa(String.fromCharCode(...bytes));
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(hash, url);
    return url;
  } catch {
    // Missing/malformed legacy metadata must never prevent rendering a shelf.
    return "";
  }
}
