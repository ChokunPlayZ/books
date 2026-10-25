import CollectionPage from "../../components/CollectionPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Lowest prices · Book Collection" };

export default async function PricesPage({
  searchParams,
}: {
  searchParams: Promise<{ isbn?: string | string[] }>;
}) {
  const { isbn } = await searchParams;
  return (
    <CollectionPage
      view="prices"
      priceIsbn={typeof isbn === "string" ? isbn.slice(0, 40) : ""}
    />
  );
}
