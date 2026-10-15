import type { NextRequest } from "next/server";
import { getApp } from "../../../lib/server/app.ts";
import { authorize } from "../../../lib/server/auth.ts";
import { errorResponse } from "../../../lib/server/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context?: { params: Promise<{ id?: string }> },
) {
  try {
    const { store, covers } = getApp();
    authorize(store, request);
    const params = await context?.params;
    const image = covers.get(
      params?.id || new URL(request.url).searchParams.get("id"),
    );
    const headers = {
      "Content-Type": image.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: image.etag,
      "X-Content-Type-Options": "nosniff",
    };
    const matches = request.headers
      .get("if-none-match")
      ?.split(",")
      .some((tag) =>
        [image.etag, "*"].includes(tag.trim().replace(/^W\//, "")),
      );
    if (matches) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(image.body), {
      headers: { ...headers, "Content-Length": String(image.body.length) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
