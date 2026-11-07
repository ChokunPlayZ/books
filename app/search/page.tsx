import CollectionPage from "../../components/CollectionPage";

export const runtime = "nodejs";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  return (
    <CollectionPage
      view="search"
      searchQuery={typeof q === "string" ? q.slice(0, 200) : ""}
    />
  );
}
