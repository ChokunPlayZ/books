import AdminPanel from "../../components/admin/AdminPanel";
import LibraryBrand from "../../components/LibraryBrand";
import ThemeToggle from "../../components/ThemeToggle";
import LanguageSelect from "../../components/LanguageSelect";
import { getApp } from "../../lib/server/app.ts";
import { requireAdminPage } from "../../lib/server/admin-auth.ts";
import { getTranslations } from "../../lib/server/preferences.ts";

export default async function AdminPage() {
  // The page checks too: layouts and pages can render independently in Next.
  // No admin props or client-component references are returned before this gate.
  const user = await requireAdminPage();
  const { store, api } = await getApp();
  const t = await getTranslations();
  const [queue, metadata, system, records] = await store.forUser(user, () =>
    Promise.all([
      api.getScrapeQueue(),
      api.getMetadataOverview(),
      api.getSystemOverview(),
      api.getSystemRecords({ resource: "users" }),
    ]),
  );
  return (
    <>
      <header className="top data-header">
        <div className="top-inner flex items-center justify-between">
          <LibraryBrand />
          <div className="header-links">
            <LanguageSelect />
            <ThemeToggle />
            <a className="btn" href="/">
              {t("Your collection")}
            </a>
          </div>
        </div>
      </header>
      <AdminPanel
        initialQueue={queue}
        initialMetadata={metadata}
        initialSystem={system}
        initialRecords={records}
      />
    </>
  );
}
