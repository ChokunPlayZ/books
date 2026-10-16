"use client";

import { useEffect } from "react";
import type { CollectionView } from "../lib/domain/navigation.ts";

export default function CollectionController({
  view,
  series,
}: {
  view: CollectionView;
  series: string | null;
}) {
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void import("../lib/client/collection").then(({ mountCollection }) => {
      if (active) dispose = mountCollection({ view, series });
    });
    return () => {
      active = false;
      dispose?.();
    };
  }, [view, series]);
  return null;
}
