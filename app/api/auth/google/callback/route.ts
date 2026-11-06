import { NextResponse, type NextRequest } from "next/server";
import { getApp } from "../../../../../lib/server/app.ts";
import {
  cookieOptions,
  SESSION_COOKIE,
  signOut,
} from "../../../../../lib/server/auth.ts";
import { appOrigin } from "../../../../../lib/server/auth-config.ts";
import {
  finishGoogleSignIn,
  OAUTH_COOKIE,
  oauthCookieOptions,
} from "../../../../../lib/server/google-oauth.ts";
import { errorResponse } from "../../../../../lib/server/http.ts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Do not reflect Host, provider error messages, codes or tokens into redirects.
  let origin: string;
  try {
    origin = appOrigin();
  } catch (error) {
    return errorResponse(error);
  }
  let response: NextResponse;
  try {
    const { store } = getApp();
    const result = await finishGoogleSignIn(
      store,
      request.nextUrl,
      request.cookies.get(OAUTH_COOKIE)?.value,
    );
    signOut(store, request.cookies.get(SESSION_COOKIE)?.value);
    response = NextResponse.redirect(new URL(result.returnTo, origin), 303);
    response.cookies.set(SESSION_COOKIE, result.token, cookieOptions());
  } catch (error) {
    // Never log tokens, authorization codes, provider payloads or callback URLs.
    console.error(
      "Google sign-in failed:",
      error instanceof Error ? error.name : "Unknown error",
    );
    response = NextResponse.redirect(
      new URL("/login?error=google", origin),
      303,
    );
  }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(OAUTH_COOKIE, "", {
    ...oauthCookieOptions(),
    maxAge: 0,
  });
  return response;
}
