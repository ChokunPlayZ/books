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
    const series = request.nextUrl.searchParams.get("series") ?? undefined;
    const date = new Date().toISOString().slice(0, 10);
    const filename =
      series === undefined
        ? `book-collection-${date}.json`
        : `book-series-${date}.json`;
    const title = Array.from(series ?? "")
      .slice(0, 100)
      .join("")
      .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_");
    const encodedName = encodeURIComponent(`${title}-${date}.json`).replace(
      /['()*]/g,
      (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase(),
    );
    const titleFilename =
      series === undefined ? "" : `; filename*=UTF-8''${encodedName}`;
    return new Response(JSON.stringify(store.exportData(series), null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"${titleFilename}`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
