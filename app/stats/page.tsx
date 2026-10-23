import CollectionPage from "../../components/CollectionPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Statistics · Book Collection" };

export default function StatsPage() {
  return <CollectionPage view="stats" />;
}
