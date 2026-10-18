import CollectionPage from "../../components/CollectionPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "What’s missing · Book Collection" };

export default function MissingPage() {
  return <CollectionPage view="missing" />;
}
