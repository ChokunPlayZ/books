export function $<K extends keyof LibraryElements>(id: K): LibraryElements[K] {
  return document.getElementById(id) as LibraryElements[K];
}

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
}

export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string | number,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = String(text);
  return e;
}

export function requestId() {
  return window.crypto?.randomUUID
    ? crypto.randomUUID()
    : "book_" + Date.now() + "_" + Math.random().toString(36).slice(2);
}

export function number(value) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value);
}

export function fillOptions(id, values, placeholder?: string) {
  const e = $(id),
    previous = e.value;
  e.replaceChildren();
  if (placeholder !== undefined) {
    const o = node("option", "", placeholder);
    o.value = "";
    e.append(o);
  }
  values.forEach((v) => {
    const o = node("option", "", v);
    o.value = v;
    e.append(o);
  });
  if ([...e.options].some((o) => o.value === previous)) e.value = previous;
}
