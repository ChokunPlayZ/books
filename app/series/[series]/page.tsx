import CollectionPage from "../../../components/CollectionPage";
import { notFound } from "next/navigation";
import { seriesFromPath } from "../../../lib/domain/navigation.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ series: string }> };

async function seriesName(params: Props["params"]) {
  try {
    return seriesFromPath((await params).series);
  } catch {
    notFound();
  }
}

export async function generateMetadata({ params }: Props) {
  return { title: (await seriesName(params)) + " · Book Collection" };
}

export default async function SeriesPage({ params }: Props) {
  return <CollectionPage series={await seriesName(params)} />;
}
