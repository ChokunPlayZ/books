import type { NextRequest } from "next/server";
import { getApp } from "../../../lib/server/app.ts";
import { authorize } from "../../../lib/server/auth.ts";
import { errorResponse } from "../../../lib/server/http.ts";
import { AppError } from "../../../lib/server/store.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context?: { params: Promise<{ id?: string }> },
) {
  try {
    const { store, covers } = await getApp();
    const user = await authorize(store, request);
    const params = await context?.params;
    const id = params?.id || new URL(request.url).searchParams.get("id");
    if (!/^[a-f0-9]{64}$/.test(id || ""))
      throw new AppError("Choose a stored cover.", 400);
    const image = await store.forUser(user, async () => {
      if (!(await store.covers.canAccess(id)))
        throw new AppError("Cover not found.", 404);
      return await covers.get(id, true);
    });
    const headers = {
      "Content-Type": image.contentType,
      "Cache-Control": "private, no-store",
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
    return await errorResponse(error);
  }
}
