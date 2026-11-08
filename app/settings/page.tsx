import { redirect } from "next/navigation";
import { pageAccount } from "../../lib/server/account-page.ts";
import { pageCollection } from "../../lib/server/collection-page.ts";
import LibraryShell from "../../components/LibraryShell";
import UserSettings from "../../components/UserSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [data, account] = await Promise.all([pageCollection(), pageAccount()]);
  if (!data || !account) redirect("/login");
  return (
    <LibraryShell
      view="settings"
      data={data}
      className="data-page settings-page"
    >
      <UserSettings account={account} />
    </LibraryShell>
  );
}
