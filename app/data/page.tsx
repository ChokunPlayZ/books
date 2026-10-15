import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getApp } from "../../lib/server/app.ts";
import {
  hasSession,
  passwordRequired,
  SESSION_COOKIE,
} from "../../lib/server/auth.ts";
import DataManager from "../../components/DataManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function DataPage() {
  const { store } = getApp();
  if (!hasSession(store, (await cookies()).get(SESSION_COOKIE)?.value))
    redirect("/login");
  const data = store.api.getCollection();
  return (
    <DataManager
      counts={{
        books: data.books.length,
        trash: data.trash.length,
        savedReleases: data.savedReleases.length,
      }}
      canSignOut={passwordRequired()}
    />
  );
}
