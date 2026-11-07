import CollectionPage from "../../components/CollectionPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "What’s missing · meemai" };

export default function MissingPage() {
  return <CollectionPage view="missing" />;
}
