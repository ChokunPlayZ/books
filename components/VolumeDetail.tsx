import LibraryShell from "./LibraryShell";
import CoverImage from "./collection/CoverImage";
import MetadataFacts from "./collection/MetadataFacts";
import SynopsisText from "./collection/SynopsisText";
import SuggestEditMenu from "./collection/SuggestEditMenu";
import ExternalLink from "./ExternalLink";
import { getTranslations } from "../lib/server/preferences.ts";
import { seriesPath } from "../lib/domain/navigation.ts";
import {
  metadataBrowsePath,
  formatMoney,
  languageName,
  volumePath,
} from "../lib/domain/series-detail.ts";
import type { KnownVolume } from "../lib/server/series-details.ts";
import type { SeriesInfo } from "../lib/domain/series-info.ts";
import { preferredSynopses } from "../lib/domain/metadata-source.ts";
import type { Store } from "../lib/server/store.ts";

export default async function VolumeDetail({
  data,
  volume,
  volumes,
  info,
}: {
  data: Awaited<ReturnType<Store["api"]["getCollection"]>>;
  volume: KnownVolume;
  volumes: KnownVolume[];
  info: SeriesInfo;
}) {
  const t = await getTranslations();
  const unknown = t("Not recorded");
  const synopses = preferredSynopses(
    volume.synopses?.length ? volume.synopses : info.synopses,
  );
  const synopsis =
    synopses.find((item) => item.language === volume.language) || synopses[0];
  const index = volumes.findIndex((item) => item.key === volume.key);
  const url = volume.publisherUrl || volume.url;
  const editionSeries = new Set(info.editions.map((edition) => edition.series));
  const editions = data.books.filter(
    (book) =>
      editionSeries.has(book.series) &&
      book.volume === volume.volume &&
      book.row !== volume.row,
  );
  return (
    <LibraryShell data={data} view="collection" className="volume-detail-page">
      <a className="text-btn" href={seriesPath(volume.series)}>
        {t("← Back to series")}
      </a>
      <div className="volume-detail-heading">
        <h1>
          {volume.series} ·{" "}
          {volume.volume === "" || volume.volume == null
            ? t("Unnumbered volume")
            : t("Volume {volume}", { volume: volume.volume })}
        </h1>
        <span className="status">
          {t(volume.owned ? "Owned copy" : "Catalog volume")}
        </span>
      </div>
      <div className="volume-detail-layout">
        <aside>
          <CoverImage
            id={volume.coverId}
            blurhash={volume.coverBlurhash}
            className="volume-detail-cover"
          >
            <span className="cover-placeholder">{t("No cover")}</span>
          </CoverImage>
          {url && (
            <ExternalLink className="btn" href={url} target="_blank">
              {t("Publisher / store page")}
            </ExternalLink>
          )}
          <SuggestEditMenu
            series={volume.series}
            type={volume.type}
            volumeKey={volume.key}
          />
        </aside>
        <div>
          <h2>{t("Edition & publication")}</h2>
          <dl className="volume-facts">
            <div>
              <dt>{t("Title")}</dt>
              <dd>{volume.title}</dd>
            </div>
            <div>
              <dt>{t("Volume")}</dt>
              <dd>
                {volume.volume === "" || volume.volume == null
                  ? unknown
                  : volume.volume}
              </dd>
            </div>
            <div>
              <dt>{t("Book type")}</dt>
              <dd>{t(volume.type)}</dd>
            </div>
            <div>
              <dt>{t("Publisher")}</dt>
              <dd>
                {volume.publisher ? (
                  <a href={metadataBrowsePath("Publisher", volume.publisher)}>
                    {volume.publisher}
                  </a>
                ) : (
                  unknown
                )}
              </dd>
            </div>
            <div>
              <dt>{t("Language")}</dt>
              <dd>{t(languageName(volume.language))}</dd>
            </div>
            <div>
              <dt>{t("Edition")}</dt>
              <dd>{volume.edition || unknown}</dd>
            </div>
            <div>
              <dt>ISBN</dt>
              <dd>{volume.isbn || unknown}</dd>
            </div>
            <div>
              <dt>{t("Pages")}</dt>
              <dd>{volume.pageCount || unknown}</dd>
            </div>
            <div>
              <dt>{t("Release date")}</dt>
              <dd>{volume.releaseDate || unknown}</dd>
            </div>
            <div>
              <dt>{t("Availability")}</dt>
              <dd>{volume.availability || unknown}</dd>
            </div>
            <div>
              <dt>{t("List price")}</dt>
              <dd>
                {formatMoney(volume.msrp, volume.msrpCurrency) || unknown}
                {volume.msrp !== "" &&
                volume.msrp != null &&
                !volume.msrpCurrency
                  ? " · " + t("Currency unspecified")
                  : ""}
              </dd>
            </div>
            <div>
              <dt>{t("Listed store price")}</dt>
              <dd>
                {formatMoney(volume.listedPrice, volume.currency) || unknown}
              </dd>
            </div>
            <div>
              <dt>{t("Source checked")}</dt>
              <dd>{volume.checkedAt || unknown}</dd>
            </div>
          </dl>
          {volume.owned && (
            <>
              <h2>{t("Your copy & purchase")}</h2>
              <dl className="volume-facts">
                <div>
                  <dt>{t("Reading status")}</dt>
                  <dd>{t(volume.status || "No status")}</dd>
                </div>
                <div>
                  <dt>{t("Price paid")}</dt>
                  <dd>{formatMoney(volume.price, "THB") || unknown}</dd>
                </div>
                <div>
                  <dt>{t("Bought from")}</dt>
                  <dd>{volume.source || unknown}</dd>
                </div>
                <div>
                  <dt>{t("Purchase date")}</dt>
                  <dd>{volume.date || unknown}</dd>
                </div>
                <div>
                  <dt>{t("Notes")}</dt>
                  <dd className="preserve-lines">{volume.note || unknown}</dd>
                </div>
              </dl>
              <a href={seriesPath(volume.series) + "#bookList"}>
                {t("Edit owned copies on the series page")}
              </a>
            </>
          )}
          {!!volume.facts?.length && (
            <>
              <h2>{t("All sourced volume details")}</h2>
              <MetadataFacts facts={volume.facts} />
            </>
          )}
          {!!info.facts?.length && (
            <>
              <h2>{t("Series creators & publication")}</h2>
              <MetadataFacts facts={info.facts} />
            </>
          )}
          {synopsis && (
            <section className="volume-synopses">
              <h2>{t("Synopsis")}</h2>
              <SynopsisText synopsis={synopsis} sourceLabel={t("Source")} />
            </section>
          )}
          <section className="volume-language-editions">
            <h2>{t("Other languages & editions")}</h2>
            {editions.length ? (
              <ul>
                {editions.map((book) => (
                  <li key={book.row}>
                    <a href={volumePath(book.series, "owned-" + book.row)}>
                      {book.series} · {book.edition || book.type} ·{" "}
                      {book.publisher}
                    </a>
                    <span>{book.isbn ? "ISBN " + book.isbn : unknown}</span>
                    <span>
                      {formatMoney(book.msrp, book.msrpCurrency) || ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">
                {t("No other owned edition is linked to this volume.")}
              </p>
            )}
            <ul>
              {volumes
                .filter(
                  (item) =>
                    !item.owned &&
                    item.key !== volume.key &&
                    item.volume === volume.volume,
                )
                .map((item) => (
                  <li key={item.key}>
                    <a href={volumePath(item.series, item.key)}>
                      {item.title} · {t(languageName(item.language))} ·{" "}
                      {item.publisher}
                    </a>
                    <span>{formatMoney(item.msrp, item.msrpCurrency)}</span>
                  </li>
                ))}
            </ul>
            <ul>
              {info.titles.map((title) => (
                <li key={JSON.stringify(title)}>
                  <span>{t(languageName(title.language))}</span>
                  <span lang={title.language}>{title.title}</span>
                  <ExternalLink href={title.url} target="_blank">
                    {title.source}
                  </ExternalLink>
                </li>
              ))}
            </ul>
            <p className="hint">
              {t(
                "Alternate titles do not confirm a licensed edition. Linked editions show only volumes in your library.",
              )}
            </p>
          </section>
        </div>
      </div>
      <nav className="volume-pagination" aria-label={t("Volume navigation")}>
        {index > 0 && (
          <a
            className="btn"
            href={volumePath(volume.series, volumes[index - 1].key)}
          >
            {t("Previous volume")}
          </a>
        )}
        <a className="btn" href={seriesPath(volume.series)}>
          {t("All volumes")}
        </a>
        {index < volumes.length - 1 && (
          <a
            className="btn"
            href={volumePath(volume.series, volumes[index + 1].key)}
          >
            {t("Next volume")}
          </a>
        )}
      </nav>
    </LibraryShell>
  );
}
