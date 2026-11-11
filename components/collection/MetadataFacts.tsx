"use client";

import { useTranslations } from "../PreferencesProvider";
import ExternalLink from "../ExternalLink";
import { metadataBrowsePath } from "../../lib/domain/series-detail.ts";
import type { SeriesFact } from "../../lib/domain/series-info.ts";

export default function MetadataFacts({ facts }: { facts: SeriesFact[] }) {
  const t = useTranslations();
  const groups = new Map<string, SeriesFact[]>();
  for (const fact of facts) {
    const key = fact.label + ":" + fact.value;
    groups.set(key, [...(groups.get(key) || []), fact]);
  }
  return (
    <dl className="metadata-facts">
      {[...groups].map(([key, records]) => {
        const fact = records[0];
        return (
          <div key={key}>
            <dt>{t(fact.label)}</dt>
            <dd>
              <a href={metadataBrowsePath(fact.label, fact.value)}>
                {fact.value}
              </a>
              <span className="metadata-attribution">
                {records.map((record) =>
                  record.url ? (
                    <ExternalLink
                      key={record.url}
                      href={record.url}
                      target="_blank"
                    >
                      {record.source}
                    </ExternalLink>
                  ) : (
                    <span key={record.source}>{record.source}</span>
                  ),
                )}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
