import { getApp } from "../../../lib/server/app.ts";
import { json } from "../../../lib/server/http.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { store } = await getApp();
    await store.db.prepare("SELECT 1").get();
    return json({ status: "ok" });
  } catch {
    return json({ status: "unavailable" }, 503);
  }
}
