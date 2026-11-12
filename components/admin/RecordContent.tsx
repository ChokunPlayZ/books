"use client";

import { useState } from "react";
import {
  fieldLabel,
  formatBytes,
  readableText,
  recordDate,
  recordFields,
  recordImage,
  recordObject,
  recordTitle,
  safeRecordLink,
  unpackRecord,
} from "../../lib/admin-presentation.ts";
import { usePreferences, useTranslations } from "../PreferencesProvider";
import Icon from "../Icon";
import ExternalLink from "../ExternalLink";

function RecordImage({ src, alt }: { src: string; alt: string }) {
  const t = useTranslations();
  const [failed, setFailed] = useState(false);
  return (
    <figure className="admin-record-image">
      {failed ? (
        <div className="admin-image-fallback">
          <Icon name="book" />
          <span>{t("Image unavailable")}</span>
        </div>
      ) : (
        <ExternalLink href={src} target="_blank" aria-label={t("Open image")}>
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        </ExternalLink>
      )}
    </figure>
  );
}

function NestedRecord({
  value,
  field,
  markup,
  resource,
  images,
}: {
  value: unknown;
  field: string;
  markup: boolean;
  resource: string;
  images: boolean;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("More nested details")}</summary>
      {open && (
        <RecordContent
          value={value}
          field={field}
          markup={markup}
          resource={resource}
          images={images}
        />
      )}
    </details>
  );
}

export function RecordContent({
  value,
  field = "",
  depth = 0,
  markup = false,
  resource = "",
  images = true,
}: {
  value: unknown;
  field?: string;
  depth?: number;
  markup?: boolean;
  resource?: string;
  images?: boolean;
}) {
  const t = useTranslations();
  const { preferences } = usePreferences();
  const literal = /^(?:note|notes|title|series|username|name|label)$/.test(
    field,
  );
  const parsed = literal ? value : unpackRecord(value);
  const locale = preferences.locale === "th" ? "th-TH" : "en-GB";
  if (parsed === null || parsed === undefined || parsed === "")
    return <span className="admin-empty-value">{t("Not provided")}</span>;
  if (typeof parsed === "boolean")
    return <span>{t(parsed ? "Yes" : "No")}</span>;
  const date = recordDate(parsed, field);
  if (date)
    return (
      <time dateTime={date}>
        {new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          ...(/_on$|On$/.test(field) ? {} : { timeStyle: "short" as const }),
        }).format(new Date(date))}
      </time>
    );
  if (typeof parsed === "number") {
    if (field === "bytes") return <span>{formatBytes(parsed, locale)}</span>;
    return <span>{new Intl.NumberFormat(locale).format(parsed)}</span>;
  }
  if (typeof parsed === "string") {
    const image = images ? recordImage(parsed, field) : "";
    if (image)
      return (
        <RecordImage
          key={image}
          src={image}
          alt={t(fieldLabel(field || "Image", resource))}
        />
      );
    const link = safeRecordLink(parsed);
    if (link)
      return (
        <ExternalLink className="admin-record-link" href={link} target="_blank">
          {link}
        </ExternalLink>
      );
    return (
      <div className="admin-readable-text">
        {markup && !literal ? readableText(parsed) : parsed}
      </div>
    );
  }
  if (depth > 12)
    return (
      <NestedRecord
        value={parsed}
        field={field}
        markup={markup}
        resource={resource}
        images={images}
      />
    );
  if (Array.isArray(parsed)) {
    if (!parsed.length)
      return <span className="admin-empty-value">{t("None")}</span>;
    return (
      <ul className="admin-value-list">
        {parsed.map((item, index) => (
          <li key={index}>
            <RecordContent
              value={item}
              field={field}
              depth={depth + 1}
              markup={markup}
              resource={resource}
              images={images}
            />
          </li>
        ))}
      </ul>
    );
  }
  const object = recordObject(parsed);
  if (!object) return <span>{String(parsed)}</span>;
  const entries = Object.entries(object).filter(
    ([, child]) => child !== undefined,
  );
  return entries.length ? (
    <dl className="admin-detail-list">
      {entries.map(([key, child]) => (
        <div key={key} className="admin-detail-field">
          <dt>{t(fieldLabel(key, resource))}</dt>
          <dd>
            <RecordContent
              value={child}
              field={key}
              depth={depth + 1}
              resource={resource}
              images={images}
              markup={
                /^(?:html|description|body|content)$/.test(key) ||
                (key === "value" &&
                  typeof object.source === "string" &&
                  object.source.startsWith("text:"))
              }
            />
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <span className="admin-empty-value">{t("None")}</span>
  );
}

export function RecordCard({
  row,
  resource,
}: {
  row: Record<string, unknown>;
  resource: string;
}) {
  const t = useTranslations();
  const fields = recordFields(row);
  const title =
    recordTitle(row) ||
    (resource === "covers" ? t("Stored cover") : t("Record"));
  const coverId =
    fields.cover_id ||
    fields.coverId ||
    (resource === "covers" ? fields.id : "");
  const image =
    recordImage(coverId, "cover_id") ||
    recordImage(fields.cover_url || fields.coverUrl || fields.url, "coverUrl");
  const omitted = new Set([
    "cover_id",
    "coverId",
    "cover_url",
    "coverUrl",
    "title",
    "series",
    "username",
    "status",
    "volume",
    "note",
  ]);
  const technical = new Set([
    "id",
    "user_id",
    "series_key",
    "revision",
    "trash_id",
    "canonical_isbn",
    "fingerprint",
    "hash",
  ]);
  const visible = Object.entries(fields).filter(
    ([key, value]) =>
      !omitted.has(key) &&
      !technical.has(key) &&
      value !== undefined &&
      value !== null &&
      value !== "",
  );
  const details = Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) =>
        technical.has(key) &&
        value !== undefined &&
        value !== null &&
        value !== "",
    ),
  );
  return (
    <article className={`admin-card admin-record${image ? " has-image" : ""}`}>
      {image && <RecordImage key={image} src={image} alt={title} />}
      <div className="admin-record-body">
        <div className="admin-record-heading">
          <h3>
            {title}
            {fields.volume !== null &&
            fields.volume !== undefined &&
            fields.volume !== ""
              ? ` · ${t("Volume")} ${fields.volume}`
              : ""}
          </h3>
          {!!fields.status && (
            <span className="admin-status">{t(String(fields.status))}</span>
          )}
          {!!fields.removed_at && (
            <span className="admin-status">{t("Removed")}</span>
          )}
        </div>
        {!!fields.username && title !== fields.username && (
          <p className="admin-record-account">
            {t("Account")}: {String(fields.username)}
          </p>
        )}
        {!!fields.series && title !== fields.series && (
          <p>{String(fields.series)}</p>
        )}
        {!!visible.length && (
          <RecordContent
            value={Object.fromEntries(visible)}
            resource={resource}
          />
        )}
        {!!fields.note && (
          <section className="admin-record-notes">
            <h4>{t("Notes")}</h4>
            <RecordContent
              value={fields.note}
              field="note"
              resource={resource}
            />
          </section>
        )}
        {!!Object.keys(details).length && (
          <details className="admin-record-details">
            <summary>{t("Details")}</summary>
            <RecordContent value={details} resource={resource} />
          </details>
        )}
      </div>
    </article>
  );
}
