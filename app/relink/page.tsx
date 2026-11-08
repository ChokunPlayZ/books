import LibraryBrand from "../../components/LibraryBrand";
import RelinkAccount from "../../components/RelinkAccount";

export const metadata = {
  title: "Re-link your library · meemai",
  robots: { index: false, follow: false },
  // Keep the same-origin POST Origin header intact. The secret lives only in a
  // fragment, which is never part of an HTTP Referer, and is removed on mount.
  referrer: "same-origin" as const,
};
export default function RelinkPage() {
  return (
    <main className="admin-page">
      <LibraryBrand />
      <RelinkAccount />
    </main>
  );
}
