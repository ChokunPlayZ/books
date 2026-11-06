import { getTranslations } from "../../lib/server/preferences.ts";

export default async function ReleasesPanel() {
  const t = await getTranslations();
  return (
    <section id={"releasesPanel"} aria-label={t("Publisher releases")}>
      <div className={"release-heading"}>
        <div>
          <p className="eyebrow">{t("The next chapter")}</p>
          <h1>{t("New releases")}</h1>
          <p className="intro">
            {t("Fresh from your favorite publishers. Find your next read.")}
          </p>
        </div>
        <div className={"buttons"}>
          <button id={"refreshReleases"} className={"btn"}>
            {t("Refresh releases")}
          </button>
        </div>
      </div>
      <details className={"publisher-details"}>
        <summary id={"publisherCheckSummary"}>
          {t("Publisher sources & check times")}
        </summary>
        <div id={"publisherSources"} className={"publisher-sources"}></div>
        <p className={"release-note"}>
          {
            "Catalog listings can include pre-orders. Special sets are skipped automatically. Dates and availability may change. Owning a regular or special edition counts toward the same volume. Colored manga matches regular manga in the same language. “Check edition” shows matching volumes with a different or missing ISBN, and other sets that need review."
          }
        </p>
      </details>
      <div id={"releaseError"} className={"banner"} role={"alert"} hidden></div>
      <div className={"toolbar release-filters"}>
        <div className={"search"}>
          <svg aria-hidden={"true"}>
            <use href={"#i-search"} />
          </svg>
          <label htmlFor={"releaseSearch"} className={"sr-only"}>
            {t("Search releases")}
          </label>
          <input
            id={"releaseSearch"}
            type={"search"}
            placeholder={t("Search releases or ISBN…")}
          />
        </div>
        <label htmlFor={"releasePublisher"} className={"sr-only"}>
          {t("Publisher")}
        </label>
        <select id={"releasePublisher"}>
          <option value={""}>{t("All publishers")}</option>
          <option value={"phoenix"}>{"Phoenix Next"}</option>
          <option value={"firstpage"}>{"First Page Pro"}</option>
          <option value={"luckpim"}>{"Luckpim"}</option>
          <option value={"yaakz"}>{"Siam Inter Comics (Yaakz)"}</option>
          <option value="yenpress">Yen Press</option>
          <option value="animag">Animag</option>
          <option value="dexpress">DEXpress</option>
          <option value="lilyhouse">Lily House</option>
          <option value="kodansha">Kodansha JP</option>
        </select>
        <label htmlFor={"releaseScope"} className={"sr-only"}>
          {t("Release list")}
        </label>
        <select id={"releaseScope"}>
          <option value={"unbought"}>{t("Not bought yet")}</option>
          <option value={"all"}>{t("All releases")}</option>
          <option value={"series"}>{t("For my series")}</option>
          <option value={"review"}>{t("Check edition")}</option>
          <option value={"owned"}>{t("On my shelf")}</option>
          <option value={"saved"}>{t("Saved for later")}</option>
        </select>
        <label htmlFor={"releaseType"} className={"sr-only"}>
          {t("Release type")}
        </label>
        <select id={"releaseType"}>
          <option value={""}>{t("All types")}</option>
          <option value="Light novel">{t("Light novel")}</option>
          <option value={"Manga"}>{t("Manga")}</option>
          <option value="Others">{t("Others")}</option>
        </select>
        <div
          className={"buttons release-visibility-filters"}
          role={"group"}
          aria-label={t("Release visibility")}
        >
          <button
            id={"hideSpecialReleases"}
            className={"btn"}
            type={"button"}
            aria-pressed={"false"}
            aria-controls={"releaseList"}
          >
            {t("Hide special editions")}
          </button>
          <button
            id={"hideSavedReleases"}
            className={"btn"}
            type={"button"}
            aria-pressed={"false"}
            aria-controls={"releaseList"}
          >
            {t("Hide saved for later")}
          </button>
          <button
            id={"hideOwnedReleases"}
            className={"btn"}
            type={"button"}
            aria-pressed={"false"}
            aria-controls={"releaseList"}
          >
            {t("Hide owned")}
          </button>
        </div>
      </div>
      <p
        id={"releaseOwnershipSummary"}
        className={"release-note"}
        role={"status"}
      ></p>
      <div className={"list-label"}>
        <span id={"releaseResultCount"} role={"status"}>
          {t("Checking publishers…")}
        </span>
      </div>
      <div id={"releaseList"} className={"release-grid"}></div>
    </section>
  );
}
