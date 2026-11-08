import AccountPreferences from "./AccountPreferences";
import AccountAvatar from "./AccountAvatar";
import SignOutButton from "./SignOutButton";
import { getTranslations } from "../lib/server/preferences.ts";
import type { Store } from "../lib/server/store.ts";

export default async function UserSettings({
  account,
}: {
  account: Awaited<ReturnType<Store["account"]["get"]>>;
}) {
  const t = await getTranslations();
  return (
    <>
      <div className="data-heading">
        <h1>{t("User settings")}</h1>
        <p className="intro">
          {t("View your signed-in account and manage your preferences.")}
        </p>
      </div>
      <nav className="data-sections" aria-label={t("Settings sections")}>
        <a href="#signed-in-account">{t("Signed-in account")}</a>
        <a href="#account-preferences">{t("Account preferences")}</a>
      </nav>
      <section
        id="signed-in-account"
        className="data-card account-info"
        aria-labelledby="accountTitle"
      >
        <h2 id="accountTitle">{t("Signed-in account")}</h2>
        <div className="account-summary">
          <AccountAvatar picture={account.picture} />
          <div>
            <p className="hint">{t("Google account")}</p>
            <strong id="accountEmail">
              {account.email || t("Not available")}
            </strong>
          </div>
        </div>
        <dl className="account-details">
          <div>
            <dt>{t("Username")}</dt>
            <dd id="accountUsername">{account.username}</dd>
          </div>
        </dl>
        <div className="account-actions">
          <p className="hint">
            {t("To use a different Google account, sign out first.")}
          </p>
          <SignOutButton />
        </div>
      </section>
      <AccountPreferences />
    </>
  );
}
