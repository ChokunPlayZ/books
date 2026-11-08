import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getApp } from "../../lib/server/app.ts";
import { sessionUser, SESSION_COOKIE } from "../../lib/server/auth.ts";
import UserSettings from "../../components/UserSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { store } = await getApp();
  const user = await sessionUser(
    store,
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (!user) redirect("/login");
  const account = await store.forUser(user, () => store.account.get());
  return <UserSettings account={account} />;
}
