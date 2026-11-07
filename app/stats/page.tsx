import CollectionPage from "../../components/CollectionPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Statistics · meemai" };

export default function StatsPage() {
  return <CollectionPage view="stats" />;
}
