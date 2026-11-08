import type { ReactNode } from "react";
import LegalLinks from "../../components/LegalLinks";
import LibraryBrand from "../../components/LibraryBrand";
import ThemeToggle from "../../components/ThemeToggle";
import LibraryShell from "../../components/LibraryShell";
import { pageCollection } from "../../lib/server/collection-page.ts";

export default async function LegalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const data = await pageCollection();
  if (data)
    return (
      <LibraryShell
        data={data}
        view={null}
        className="legal-library-page"
        lang="en"
      >
        <div className="legal-document">{children}</div>
      </LibraryShell>
    );
  return (
    <div className="legal-page">
      <header className="legal-header">
        <LibraryBrand />
        <ThemeToggle />
      </header>
      <main className="legal-document" lang="en">
        {children}
      </main>
      <footer className="legal-footer">
        <LegalLinks />
      </footer>
    </div>
  );
}
