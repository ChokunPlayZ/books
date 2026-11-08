import CollectionPage from "../../../components/CollectionPage";
import { permanentRedirect } from "next/navigation";
import { seriesPath } from "../../../lib/domain/navigation.ts";
import { seriesPageName } from "../../../lib/server/collection-page.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ series: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function seriesDetails({ params, searchParams }: Props) {
  const { series: segment } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams))
    for (const item of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value])
      query.append(key, item);
  const suffix = query.size ? "?" + query : "";
  return { segment, suffix, series: await seriesPageName(segment, suffix) };
}

export async function generateMetadata(props: Props) {
  return { title: (await seriesDetails(props)).series + " · meemai" };
}

export default async function SeriesPage(props: Props) {
  const { segment, series, suffix } = await seriesDetails(props);
  const path = seriesPath(series);
  if (path !== "/series/" + segment) permanentRedirect(path + suffix);
  return <CollectionPage series={series} />;
}
