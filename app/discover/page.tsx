import CollectionPage from "../../components/CollectionPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Discover titles · meemai" };

export default function DiscoverPage() {
  return <CollectionPage view="discover" />;
}
