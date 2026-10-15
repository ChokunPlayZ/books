import type { NextRequest } from "next/server";
import { getApp } from "../../../lib/server/app.ts";
import {
  signOut,
  SESSION_COOKIE,
  cookieOptions,
} from "../../../lib/server/auth.ts";
import { json, errorResponse, sameOrigin } from "../../../lib/server/http.ts";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    signOut(getApp().store, request.cookies.get(SESSION_COOKIE)?.value);
    const response = json({ signedIn: false });
    response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
