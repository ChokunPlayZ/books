import type { ReactNode } from "react";
import CollectionHeader from "./collection/CollectionHeader";
import CollectionTabs from "./collection/CollectionTabs";
import IconSymbols from "./collection/IconSymbols";
import LegalLinks from "./LegalLinks";
import type { LibraryView } from "../lib/domain/navigation.ts";
import type { Store } from "../lib/server/store.ts";
import { getTranslations } from "../lib/server/preferences.ts";

/** Shared chrome for every signed-in, user-facing page. */
export default async function LibraryShell({
  children,
  data,
  view,
  className = "",
  actions,
  footerActions,
  lang,
}: {
  children: ReactNode;
  data: Awaited<ReturnType<Store["api"]["getCollection"]>>;
  view: LibraryView | null;
  className?: string;
  actions?: ReactNode;
  footerActions?: ReactNode;
  lang?: string;
}) {
  const t = await getTranslations();
  return (
    <>
      <a className="skip-link" href="#libraryMain">
        {t("Skip to library")}
      </a>
      <IconSymbols />
      <CollectionHeader>{actions}</CollectionHeader>
      <CollectionTabs view={view} data={data} />
      <main
        id="libraryMain"
        data-user-id={data.user.id}
        className={"library-main " + className}
        tabIndex={-1}
        lang={lang}
      >
        {children}
        <footer className="footer">
          <span id="syncNote">{t("Saved in your library")}</span>
          <LegalLinks />
          {footerActions}
        </footer>
      </main>
    </>
  );
}
