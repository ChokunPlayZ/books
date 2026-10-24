"use client";

import { useEffect } from "react";

/** Keep the current destination visible in the handheld navigation strip. */
export default function NavigationPosition({ view }: { view: string }) {
  useEffect(() => {
    const nav = document.getElementById("libraryNavigation");
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft =
      active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
  }, [view]);
  return null;
}
