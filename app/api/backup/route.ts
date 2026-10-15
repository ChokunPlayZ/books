import type { NextRequest } from "next/server";
import { getApp } from "../../../lib/server/app.ts";
import { authorize } from "../../../lib/server/auth.ts";
import { errorResponse } from "../../../lib/server/http.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  try {
    const { store } = getApp();
    authorize(store, request);
    return new Response(JSON.stringify(store.exportData(), null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="book-collection-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
