import AccountPreferences from "./AccountPreferences";
import AdminLink from "./AdminLink";
import Icon from "./Icon";
import LanguageSelect from "./LanguageSelect";
import LegalLinks from "./LegalLinks";
import LibraryBrand from "./LibraryBrand";
import SignOutButton from "./SignOutButton";
import ThemeToggle from "./ThemeToggle";
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
      <a className="skip-link" href="#settingsMain">
        {t("Skip to settings")}
      </a>
      <header className="top data-header">
        <div className="top-inner flex items-center justify-between">
          <LibraryBrand />
          <div className="header-links">
            <AdminLink />
            <LanguageSelect />
            <ThemeToggle />
            <a className="btn return-link" href="/">
              <Icon name="arrow" />
              {t("Your collection")}
            </a>
          </div>
        </div>
      </header>
      <main id="settingsMain" className="data-page settings-page" tabIndex={-1}>
        <div className="data-heading">
          <h1>{t("User settings")}</h1>
          <p className="intro">
            {t("View your signed-in account and manage your preferences.")}
          </p>
        </div>
        <nav className="data-sections" aria-label={t("Settings sections")}>
          <a href="#signed-in-account">{t("Signed-in account")}</a>
          <a href="#account-preferences">{t("Account preferences")}</a>
          <a href="/data">{t("Data & backups")}</a>
        </nav>
        <section
          id="signed-in-account"
          className="data-card account-info"
          aria-labelledby="accountTitle"
        >
          <h2 id="accountTitle">{t("Signed-in account")}</h2>
          <div className="account-summary">
            <span className="account-avatar">
              <Icon name="user" />
            </span>
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
            <div>
              <dt>{t("Account role")}</dt>
              <dd id="accountRole">
                {t(account.role === "admin" ? "Administrator" : "User")}
              </dd>
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
        <footer className="data-footer">
          <span>
            <Icon name="lock" />
            {t("Stored in your library. Always yours.")}
          </span>
          <LegalLinks />
        </footer>
      </main>
    </>
  );
}
