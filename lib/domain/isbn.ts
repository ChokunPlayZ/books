// Registration groups used by the language-specific catalog sources.
// 978-0/1 are English-speaking groups; 979-8 is assigned to the US.
export const ISBN_GROUP_PREFIXES = Object.freeze({
  thai: ["978611", "978616", "978974"],
  japanese: ["9784"],
  english: ["9780", "9781", "9798"],
});

export function normalizeIsbn(raw) {
  const value = String(raw === undefined || raw === null ? "" : raw)
    .trim()
    .replace(/^ISBN(?:-1[03])?\s*:?\s*/i, "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  if (!value) return "";
  let sum = 0;
  if (/^\d{9}[\dX]$/.test(value)) {
    for (let i = 0; i < 10; i++)
      sum += (value[i] === "X" ? 10 : Number(value[i])) * (10 - i);
    if (sum % 11 === 0) return value;
  } else if (/^97[89]\d{10}$/.test(value)) {
    for (let i = 0; i < 13; i++) sum += Number(value[i]) * (i % 2 ? 3 : 1);
    if (sum % 10 === 0) return value;
  }
  throw new Error(
    "That ISBN is not valid. Scan the 978/979 barcode or enter a valid ISBN-10/ISBN-13.",
  );
}

export function canonicalIsbn(raw) {
  let value;
  try {
    value = normalizeIsbn(raw);
  } catch (e) {
    return "";
  }
  if (value.length !== 10) return value;
  const stem = "978" + value.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(stem[i]) * (i % 2 ? 3 : 1);
  return stem + ((10 - (sum % 10)) % 10);
}
