import type { NextRequest } from "next/server";
import { getApp } from "../../../lib/server/app.ts";
import { authorize } from "../../../lib/server/auth.ts";
import { AppError } from "../../../lib/server/store.ts";
import {
  enforceRateLimit,
  limitConcurrentRequests,
} from "../../../lib/server/rate-limit.ts";
import { parseImport, importSummary } from "../../../lib/server/importer.ts";
import { readImportForm } from "../../../lib/server/import-upload.ts";
import { json, errorResponse, sameOrigin } from "../../../lib/server/http.ts";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const { store } = await getApp();
    const user = await authorize(store, request);
    sameOrigin(request);
    await enforceRateLimit(store, `import:${user.id}`, 10, 15 * 60_000);
    // Also cap aggregate uploads: public signup must not multiply the per-user
    // memory budget into an unbounded number of simultaneous large bodies.
    return await limitConcurrentRequests(
      0,
      () =>
        limitConcurrentRequests(user.id, async () => {
          const form = await readImportForm(request);
          const file = form.get("file");
          if (!file || typeof file === "string")
            throw new AppError("Choose an import file.");
          const plan = parseImport(
            Buffer.from(await file.arrayBuffer()),
            file.name,
          );
          if (form.get("action") === "preview")
            return await json(importSummary(plan));
          if (
            form.get("action") !== "import" ||
            form.get("fingerprint") !== plan.fingerprint
          )
            throw new AppError("Review this file before importing it.");
          return await json(
            await store.forUser(
              user,
              async () => await store.importData(plan, plan.fingerprint),
            ),
          );
        }),
      1,
    );
  } catch (error) {
    return await errorResponse(error);
  }
}
