import CollectionPage from "../../components/CollectionPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "New releases · meemai" };

export default function ReleasesPage() {
  return <CollectionPage view="releases" />;
}
