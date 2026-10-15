import type { NextRequest } from "next/server";
import { getApp } from "../../../lib/server/app.ts";
import { authorize } from "../../../lib/server/auth.ts";
import { AppError } from "../../../lib/server/store.ts";
import { parseImport, importSummary } from "../../../lib/server/importer.ts";
import {
  json,
  errorResponse,
  sameOrigin,
  readBody,
} from "../../../lib/server/http.ts";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const { store } = getApp();
    authorize(store, request);
    sameOrigin(request);
    const buffer = await readBody(request, 129 * 1024 * 1024);
    const form = await new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
    const file = form.get("file");
    if (!file || typeof file === "string")
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
