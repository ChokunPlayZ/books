// Keep the existing bounded character pagination, but return the values in that
// window as structured data instead of making people read JSON fragments.
export function cachePreviewData(
  value: unknown,
  offset: number,
  size = 16000,
): unknown {
  let position = 0;
  const end = offset + size;
  function visit(node: unknown, depth: number): unknown {
    if (node === null || typeof node !== "object") {
      const encoded = JSON.stringify(node);
      const start = position;
      position += encoded.length;
      if (position <= offset || start >= end) return undefined;
      if (typeof node !== "string" || encoded.length <= size) return node;
      let cursor = start + 1;
      let text = "";
      for (const character of node) {
        const length = JSON.stringify(character).length - 2;
        if (cursor < end && cursor + length > offset) text += character;
        cursor += length;
        if (cursor >= end) break;
      }
      return text;
    }
    const array = Array.isArray(node);
    const entries = Object.entries(node);
    if (!entries.length) {
      const start = position;
      position += 2;
      return position > offset && start < end ? node : undefined;
    }
    position += 2; // Opening bracket and newline.
    const visible: [string, unknown][] = [];
    for (let index = 0; index < entries.length; index++) {
      const [key, child] = entries[index];
      position +=
        (depth + 1) * 2 + (array ? 0 : JSON.stringify(key).length + 2);
      const result = visit(child, depth + 1);
      if (result !== undefined) visible.push([key, result]);
      position += index === entries.length - 1 ? 1 : 2; // Comma/newline.
    }
    position += depth * 2 + 1;
    if (!visible.length) return undefined;
    return array
      ? visible.map(([, child]) => child)
      : Object.fromEntries(visible);
  }
  return visit(value, 0) ?? null;
}
