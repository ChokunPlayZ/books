import MetadataReviewQueue from "../../../components/admin/MetadataReviewQueue";
import { requireAdminPage } from "../../../lib/server/admin-auth.ts";
import { getApp } from "../../../lib/server/app.ts";
import { getTranslations } from "../../../lib/server/preferences.ts";

export default async function SuggestionsPage() {
  const user = await requireAdminPage();
  const { store, api } = await getApp();
  const data = await store.forUser(user, () =>
    api.getMetadataSuggestions({ all: true }),
  );
  const t = await getTranslations();
  return (
    <main className="library-main">
      <a className="text-btn" href="/admin">
        {t("← Administration")}
      </a>
      <MetadataReviewQueue initial={data.items} />
    </main>
  );
}
