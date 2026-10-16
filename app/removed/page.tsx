import CollectionPage from "../../components/CollectionPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Recently removed · Book Collection" };

export default function RemovedPage() {
  return <CollectionPage view="trash" />;
}
