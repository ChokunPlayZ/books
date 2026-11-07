import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getApp } from "../../lib/server/app.ts";
import { sessionUser, SESSION_COOKIE } from "../../lib/server/auth.ts";
import DataManager from "../../components/DataManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function DataPage() {
  const { store } = await getApp();
  const user = await sessionUser(
    store,
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (!user) redirect("/login");
  const data = await store.forUser(user, () => store.api.getCollection());
  return (
    <DataManager
      counts={{
        books: data.books.length,
        trash: data.trash.length,
        savedReleases: data.savedReleases.length,
      }}
      canSignOut={true}
    />
  );
}
