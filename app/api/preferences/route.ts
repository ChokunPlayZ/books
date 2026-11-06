import type { NextRequest } from "next/server";
import { getApp } from "../../../lib/server/app.ts";
import { authorize } from "../../../lib/server/auth.ts";
import {
  json,
  errorResponse,
  sameOrigin,
  readJson,
} from "../../../lib/server/http.ts";
import { enforceRateLimit } from "../../../lib/server/rate-limit.ts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { store } = await getApp();
    const user = await authorize(store, request);
    return await json(await store.forUser(user, () => store.preferences.get()));
  } catch (error) {
    return await errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { store } = await getApp();
    const user = await authorize(store, request);
    sameOrigin(request);
    await enforceRateLimit(store, `preferences:${user.id}`, 60, 60_000);
    const changes = await readJson(request, 1024);
    return await json(
      await store.forUser(user, () => store.preferences.update(changes)),
    );
  } catch (error) {
    return await errorResponse(error);
  }
}
