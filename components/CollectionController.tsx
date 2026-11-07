"use client";

import { useEffect, useState } from "react";
import type { CollectionView } from "../lib/domain/navigation.ts";
import type { StoredBook } from "../lib/types.ts";
import { useTranslations } from "./PreferencesProvider";

export default function CollectionController({
  view,
  series,
  onBooksChange,
}: {
  view: CollectionView;
  series: string | null;
  onBooksChange?: (books: StoredBook[]) => void;
}) {
  const t = useTranslations();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    setReady(false);
    setFailed(false);
    void import("../lib/client/collection")
      .then(({ mountCollection }) => {
        if (active) {
          dispose = mountCollection({ view, series, onBooksChange });
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      dispose?.();
    };
  }, [view, series, onBooksChange]);
  if (failed)
    return (
      <p className="collection-initial-loading form-error" role="alert">
        {t("Library controls could not load. Refresh the page to try again.")}
      </p>
    );
  return ready ? null : (
    <div className="collection-initial-loading" role="status">
      <span className="loading-spinner" aria-hidden="true" />{" "}
      {t("Loading your library…")}
    </div>
  );
}
