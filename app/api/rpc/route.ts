import type { NextRequest } from "next/server";
import { getApp } from "../../../lib/server/app.ts";
import { authorize } from "../../../lib/server/auth.ts";
import { AppError } from "../../../lib/server/store.ts";
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
    authorize(store, request);
    sameOrigin(request);
    const { name, arg } = await readJson(request);
    if (!Object.hasOwn(api, name))
      throw new AppError("Unknown library action.", 404);
    return json(await api[name](arg));
  } catch (error) {
    return errorResponse(error);
  }
}
