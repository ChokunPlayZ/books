import CollectionPage from "../../components/CollectionPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Discover titles · Book Collection" };

export default function DiscoverPage() {
  return <CollectionPage view="discover" />;
}
