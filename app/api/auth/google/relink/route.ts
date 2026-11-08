import { NextResponse, type NextRequest } from "next/server";
import { getApp } from "../../../../../lib/server/app.ts";
import {
  beginGoogleSignIn,
  OAUTH_COOKIE,
  oauthCookieOptions,
} from "../../../../../lib/server/google-oauth.ts";
import {
  errorResponse,
  sameOrigin,
  readBody,
} from "../../../../../lib/server/http.ts";
import { enforceRateLimit } from "../../../../../lib/server/rate-limit.ts";
import { AppError } from "../../../../../lib/server/store.ts";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { store } = await getApp();
    await enforceRateLimit(store, "oauth:relink", 100, 60_000);
    if (
      !request.headers
        .get("content-type")
        ?.startsWith("application/x-www-form-urlencoded")
    )
      throw new AppError("Submit the re-link confirmation form.", 415);
    const form = new URLSearchParams(
      (await readBody(request, 2048)).toString("utf8"),
    );
    if (form.get("confirmed") !== "yes")
      throw new AppError("Confirm the account re-link first.");
    const { url, browserToken } = await beginGoogleSignIn(
      store,
      "/",
      form.get("token"),
    );
    const response = NextResponse.redirect(url, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(OAUTH_COOKIE, browserToken, oauthCookieOptions());
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
