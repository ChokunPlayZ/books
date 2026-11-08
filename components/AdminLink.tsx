import { adminSession } from "../lib/server/admin-auth.ts";
import { getTranslations } from "../lib/server/preferences.ts";
import Icon from "./Icon";

export default async function AdminLink() {
  const user = await adminSession();
  if (user?.role !== "admin") return null;
  const t = await getTranslations();
  return (
    <a
      className="btn admin-link"
      href="/admin"
      aria-label={t("Administration")}
    >
      <Icon name="grid" />
      <span>{t("Administration")}</span>
    </a>
  );
}
