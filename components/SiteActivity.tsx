"use client";

import { useEffect, useSyncExternalStore } from "react";
import { activity } from "../lib/client/activity.ts";
import { useTranslations } from "./PreferencesProvider";

const serverSnapshot = () => "";

export default function SiteActivity() {
  const t = useTranslations();
  const label = useSyncExternalStore(
    activity.subscribe,
    activity.getSnapshot,
    serverSnapshot,
  );

  useEffect(() => {
    let finishNavigation: (() => void) | undefined;
    function reset() {
      finishNavigation?.();
      finishNavigation = undefined;
    }
    function navigate(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element).closest?.("a[href]");
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self")
      )
        return;
      const url = new URL(link.href);
      if (
        url.origin !== window.location.origin ||
        url.pathname.startsWith("/api/") ||
        (url.pathname === window.location.pathname &&
          url.search === window.location.search &&
          (url.hash || link.getAttribute("href")?.startsWith("#")))
      )
        return;
      reset();
      finishNavigation = activity.begin("Loading page…");
    }
    document.addEventListener("click", navigate);
    window.addEventListener("pagehide", reset);
    window.addEventListener("pageshow", reset);
    return () => {
      document.removeEventListener("click", navigate);
      window.removeEventListener("pagehide", reset);
      window.removeEventListener("pageshow", reset);
      reset();
    };
  }, []);

  return (
    <div className="site-activity" hidden={!label}>
      <div className="site-activity-bar" aria-hidden="true" />
      <div className="site-activity-message" role="status">
        {label && <span className="loading-spinner" aria-hidden="true" />}
        {t(label)}
      </div>
    </div>
  );
}
