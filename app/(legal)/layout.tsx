import type { ReactNode } from "react";
import LegalLinks from "../../components/LegalLinks";
import LibraryBrand from "../../components/LibraryBrand";
import ThemeToggle from "../../components/ThemeToggle";

export default function LegalLayout({ children }: { children: ReactNode }) {
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
