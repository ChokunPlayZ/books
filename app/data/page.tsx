import { redirect } from "next/navigation";
import { pageCollection } from "../../lib/server/collection-page.ts";
import DataManager from "../../components/DataManager";
import LibraryShell from "../../components/LibraryShell";
import SignOutButton from "../../components/SignOutButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function DataPage() {
  const data = await pageCollection();
  if (!data) redirect("/login");
  return (
    <LibraryShell
      view="data"
      data={data}
      className="data-page"
      footerActions={<SignOutButton className="text-btn" />}
    >
      <DataManager
        counts={{
          books: data.books.length,
          trash: data.trash.length,
          savedReleases: data.savedReleases.length,
        }}
      />
    </LibraryShell>
  );
}
