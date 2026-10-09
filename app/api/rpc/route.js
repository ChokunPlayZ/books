import { getApp } from "../../../lib/server/app.mjs";
import { authorize } from "../../../lib/server/auth.mjs";
import { AppError } from "../../../lib/server/store.mjs";
import {
  json,
  errorResponse,
  sameOrigin,
  readJson,
} from "../../../lib/server/http.mjs";

export const runtime = "nodejs";
export async function POST(request) {
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
