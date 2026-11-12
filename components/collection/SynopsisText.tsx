import type { Synopsis } from "../../lib/domain/series-info.ts";
import { synopsisPresentation } from "../../lib/domain/synopsis.ts";

export default function SynopsisText({
  synopsis,
  sourceLabel,
}: {
  synopsis: Synopsis;
  sourceLabel: string;
}) {
  const { text, source } = synopsisPresentation(synopsis);
  return (
    <>
      <p className="series-synopsis-text" lang={synopsis.language}>
        {text}
      </p>
      {source && (
        <p className="synopsis-source">
          {sourceLabel}: {source}
        </p>
      )}
    </>
  );
}
