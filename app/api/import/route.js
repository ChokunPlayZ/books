import { getApp } from "../../../lib/server/app.mjs";
import { authorize } from "../../../lib/server/auth.mjs";
import { AppError } from "../../../lib/server/store.mjs";
import { parseImport, importSummary } from "../../../lib/server/importer.mjs";
import {
  json,
  errorResponse,
  sameOrigin,
  readBody,
} from "../../../lib/server/http.mjs";
export const runtime = "nodejs";
export async function POST(request) {
  try {
    const { store } = getApp();
    authorize(store, request);
    sameOrigin(request);
    const buffer = await readBody(request, 129 * 1024 * 1024);
    const form = await new Response(buffer, {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function")
      throw new AppError("Choose an import file.");
    const plan = parseImport(Buffer.from(await file.arrayBuffer()), file.name);
    if (form.get("action") === "preview") return json(importSummary(plan));
    if (
      form.get("action") !== "import" ||
      form.get("fingerprint") !== plan.fingerprint
    )
      throw new AppError("Review this file before importing it.");
    return json(store.importData(plan, plan.fingerprint));
  } catch (error) {
    return errorResponse(error);
  }
}
