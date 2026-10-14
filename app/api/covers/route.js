import { getApp } from "../../../lib/server/app.mjs";
import { authorize } from "../../../lib/server/auth.mjs";
import { errorResponse } from "../../../lib/server/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { store, covers } = getApp();
    authorize(store, request);
    const image = await covers.get(
      new URL(request.url).searchParams.get("url"),
    );
    const headers = {
      "Content-Type": image.contentType,
      "Cache-Control": "private, max-age=" + (image.stale ? 300 : 86400),
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
    return new Response(image.body, {
      headers: { ...headers, "Content-Length": String(image.body.length) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
