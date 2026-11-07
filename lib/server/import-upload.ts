import { AppError } from "./store.ts";
import { readBody } from "./http.ts";

export async function readImportForm(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  // Browser FormData uses this bounded ASCII boundary syntax. A single,
  // unambiguous boundary keeps the preflight and native parser in agreement.
  const match =
    /^multipart\/form-data\s*;\s*boundary=(?:"([0-9a-z'()+_,./:=?-]{1,70})"|([0-9a-z'()+_,./:=?-]{1,70}))\s*$/i.exec(
      contentType,
    );
  if (!match) throw new AppError("Expected a multipart import upload.", 415);
  const buffer = await readBody(request, 129 * 1024 * 1024, 120_000);
  const boundary = Buffer.from("--" + (match[1] || match[2]));
  let offset = 0,
    occurrences = 0;
  while ((offset = buffer.indexOf(boundary, offset)) !== -1) {
    // Each part requires this marker, even in malformed envelopes. Check before
    // formData allocates objects: 129 MB can otherwise contain millions of parts.
    if (++occurrences > 8)
      throw new AppError("The import upload contains too many fields.");
    offset += boundary.length;
  }
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw new AppError("The import upload could not be read.");
  }
  const fields = new Set<string>();
  for (const [name, value] of form) {
    if (
      !["file", "action", "fingerprint"].includes(name) ||
      fields.has(name) ||
      (name === "file" ? typeof value === "string" : typeof value !== "string")
    )
      throw new AppError("The import upload contains invalid fields.");
    fields.add(name);
  }
  return form;
}
