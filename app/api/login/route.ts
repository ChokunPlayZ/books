import type { NextRequest } from "next/server";
import { getApp } from "../../../lib/server/app.ts";
import {
  signIn,
  SESSION_COOKIE,
  cookieOptions,
} from "../../../lib/server/auth.ts";
import {
  json,
  errorResponse,
  sameOrigin,
  readJson,
} from "../../../lib/server/http.ts";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { password } = await readJson(request);
    const result = signIn(getApp().store, password);
    if (result.error) throw result.error;
    const response = json({ signedIn: true });
    response.cookies.set(SESSION_COOKIE, result.token, cookieOptions());
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
