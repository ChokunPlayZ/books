import { adminSession } from "../lib/server/admin-auth.ts";
import { getTranslations } from "../lib/server/preferences.ts";

export default async function AdminLink() {
  const user = await adminSession();
  if (user?.role !== "admin") return null;
  const t = await getTranslations();
  return (
    <a className="btn admin-link" href="/admin">
      {t("Administration")}
    </a>
  );
}
