"use client";

import { useEffect } from "react";
import type { CollectionView } from "../lib/domain/navigation.ts";
import type { StoredBook } from "../lib/types.ts";

export default function CollectionController({
  view,
  series,
  onBooksChange,
}: {
  view: CollectionView;
  series: string | null;
  onBooksChange?: (books: StoredBook[]) => void;
}) {
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void import("../lib/client/collection").then(({ mountCollection }) => {
      if (active) dispose = mountCollection({ view, series, onBooksChange });
    });
    return () => {
      active = false;
      dispose?.();
    };
  }, [view, series, onBooksChange]);
  return null;
}
