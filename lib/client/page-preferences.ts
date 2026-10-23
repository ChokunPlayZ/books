import { $ } from "./dom.ts";
import type { CollectionView } from "../domain/navigation.ts";

export function restorePagePreferences(view: CollectionView) {
  const fields =
    view === "releases"
      ? ([
          "releaseSearch",
          "releasePublisher",
          "releaseScope",
          "releaseType",
          "hideSpecialReleases",
        ] as const)
      : view === "discover"
        ? ([
            "discoveryMode",
            "animeBookType",
            "animeTranslation",
            "animeAiring",
            "animeSeasonSearch",
            "discoveryPreset",
            "discoveryUrl",
            "discoverySearch",
            "discoveryType",
          ] as const)
        : [];
  const key = "books:page-preferences:" + view;
  try {
    const values: unknown = JSON.parse(sessionStorage.getItem(key) || "{}");
    if (values && typeof values === "object") {
      for (const id of fields) {
        const value = values[id],
          control = $(id);
        if (!control || typeof value !== "string") continue;
        if (id === "hideSpecialReleases")
          control.setAttribute("aria-pressed", String(value === "true"));
        else if (
          !(control instanceof HTMLSelectElement) ||
          [...control.options].some((option) => option.value === value)
        )
          control.value = value;
      }
    }
  } catch {
    // Browsers can disable storage; filters still work for the current page.
  }
  return () => {
    if (!fields.length) return;
    const values = Object.fromEntries(
      fields.flatMap((id) => {
        const control = $(id);
        return control
          ? [
              [
                id,
                id === "hideSpecialReleases"
                  ? control.getAttribute("aria-pressed")
                  : control.value,
              ],
            ]
          : [];
      }),
    );
    try {
      sessionStorage.setItem(key, JSON.stringify(values));
    } catch {}
  };
}
