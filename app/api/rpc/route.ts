import type { NextRequest } from "next/server";
import { getApp } from "../../../lib/server/app.ts";
import { authorize } from "../../../lib/server/auth.ts";
import { AppError } from "../../../lib/server/store.ts";
import {
  enforceRateLimit,
  limitConcurrentRequests,
} from "../../../lib/server/rate-limit.ts";
import {
  json,
  errorResponse,
  sameOrigin,
  readJson,
} from "../../../lib/server/http.ts";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const { store, api } = getApp();
    const user = authorize(store, request);
    sameOrigin(request);
    enforceRateLimit(store, `rpc:${user.id}`, 240, 60_000);
    // Bulk volume edits can include many volumes in a single transaction.
    const { name, arg } = await readJson(request, 1_000_000);
    if (!Object.hasOwn(api, name))
      throw new AppError("Unknown library action.", 404);
    return json(
      await limitConcurrentRequests(user.id, () =>
        store.forUser(user, () => api[name](arg)),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
