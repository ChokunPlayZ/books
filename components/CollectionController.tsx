"use client";

import { useEffect } from "react";

export default function CollectionController() {
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void import("../lib/client/collection").then(({ mountCollection }) => {
      if (active) dispose = mountCollection();
    });
    return () => {
      active = false;
      dispose?.();
    };
  }, []);
  return null;
}
