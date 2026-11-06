import { NextResponse, type NextRequest } from "next/server";
import { getApp } from "../../../../lib/server/app.ts";
import {
  beginGoogleSignIn,
  OAUTH_COOKIE,
  oauthCookieOptions,
} from "../../../../lib/server/google-oauth.ts";
import { errorResponse, sameOrigin } from "../../../../lib/server/http.ts";
import { enforceRateLimit } from "../../../../lib/server/rate-limit.ts";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { store } = await getApp();
    await enforceRateLimit(store, "oauth:start", 300, 60_000);
    const { url, browserToken } = await beginGoogleSignIn(
      store,
      request.nextUrl.searchParams.get("returnTo"),
    );
    const response = NextResponse.redirect(url, 303);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(OAUTH_COOKIE, browserToken, oauthCookieOptions());
    return response;
  } catch (error) {
    return await errorResponse(error);
  }
}
