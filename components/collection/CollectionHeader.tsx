import LibraryBrand from "../LibraryBrand";
import ThemeToggle from "../ThemeToggle";
import LanguageSelect from "../LanguageSelect";
import { getTranslations } from "../../lib/server/preferences.ts";
import AdminLink from "../AdminLink";
import type { ReactNode } from "react";
import AccountAvatar from "../AccountAvatar";
import { pageAccount } from "../../lib/server/account-page.ts";

export default async function CollectionHeader({
  children,
}: {
  children?: ReactNode;
}) {
  const t = await getTranslations();
  const account = await pageAccount();
  return (
    <header className="top library-header">
      <div className="top-inner flex items-center justify-between">
        <LibraryBrand />
        <div className={"top-actions"}>
          <div className="header-links">
            <AdminLink />
            <LanguageSelect />
            <ThemeToggle />
            {account && (
              <a
                className="profile-link"
                href="/settings"
                aria-label={t("Signed-in account")}
              >
                <AccountAvatar picture={account.picture} />
              </a>
            )}
          </div>
        </div>
        {children}
      </div>
    </header>
  );
}
