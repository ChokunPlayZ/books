import { notFound, permanentRedirect, redirect } from "next/navigation";
import VolumeDetail from "../../../../../components/VolumeDetail";
import {
  pageCollection,
  seriesPageName,
} from "../../../../../lib/server/collection-page.ts";
import { getApp } from "../../../../../lib/server/app.ts";
import { normalizeBookType } from "../../../../../lib/domain/book-type.ts";
import { volumePath } from "../../../../../lib/domain/series-detail.ts";
import type { KnownVolume } from "../../../../../lib/server/series-details.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Volume details · meemai" };

export default async function VolumePage({
  params,
}: {
  params: Promise<{ series: string; volume: string }>;
}) {
  const { series: segment, volume: key } = await params;
  if (!/^(?:owned-\d+|catalog-[A-Za-z0-9_-]{43})$/.test(key)) notFound();
  const data = await pageCollection();
  if (!data)
    redirect(
      "/login?returnTo=" +
        encodeURIComponent("/series/" + segment + "/volumes/" + key),
    );
  const series = await seriesPageName(segment);
  const canonical = volumePath(series, key);
  if (canonical !== "/series/" + segment + "/volumes/" + key)
    permanentRedirect(canonical);
  const types = [
    ...new Set(
      data.books
        .filter((book) => book.series === series)
        .map((book) => normalizeBookType(book.type)),
    ),
  ];
  const { store, api } = await getApp();
  const groups = await store.forUser(data.user, () =>
    Promise.all(types.map((type) => api.getSeriesVolumes({ series, type }))),
  );
  const volumes: KnownVolume[] = groups.flatMap((group) => group.items);
  const volume = volumes.find((item) => item.key === key);
  if (!volume) notFound();
  const info = await store.forUser(data.user, () =>
    api.getSeriesInfo({ series, type: volume.type }),
  );
  return (
    <VolumeDetail data={data} volume={volume} volumes={volumes} info={info} />
  );
}
