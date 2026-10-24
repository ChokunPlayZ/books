export default function ReleasesPanel() {
  return (
    <section id={"releasesPanel"} aria-label={"Publisher releases"}>
      <div className={"release-heading"}>
        <div>
          <p className="eyebrow">The next chapter</p>
          <h1>{"New releases"}</h1>
          <p className="intro">
            Fresh from your favorite publishers. Find your next read.
          </p>
        </div>
        <div className={"buttons"}>
          <button id={"refreshReleases"} className={"btn"}>
            {"Refresh releases"}
          </button>
        </div>
      </div>
      <details className={"publisher-details"}>
        <summary id={"publisherCheckSummary"}>
          {"Publisher sources & check times"}
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
            {"Search releases"}
          </label>
          <input
            id={"releaseSearch"}
            type={"search"}
            placeholder={"Search releases or ISBN…"}
          />
        </div>
        <label htmlFor={"releasePublisher"} className={"sr-only"}>
          {"Publisher"}
        </label>
        <select id={"releasePublisher"}>
          <option value={""}>{"All publishers"}</option>
          <option value={"phoenix"}>{"Phoenix Next"}</option>
          <option value={"firstpage"}>{"First Page Pro"}</option>
          <option value={"luckpim"}>{"Luckpim"}</option>
          <option value={"yaakz"}>{"Siam Inter Comics (Yaakz)"}</option>
          <option value="yenpress">Yen Press</option>
          <option value="animag">Animag</option>
        </select>
        <label htmlFor={"releaseScope"} className={"sr-only"}>
          {"Release list"}
        </label>
        <select id={"releaseScope"}>
          <option value={"unbought"}>{"Not bought yet"}</option>
          <option value={"all"}>{"All releases"}</option>
          <option value={"series"}>{"For my series"}</option>
          <option value={"review"}>{"Check edition"}</option>
          <option value={"owned"}>{"On my shelf"}</option>
          <option value={"saved"}>{"Saved for later"}</option>
        </select>
        <label htmlFor={"releaseType"} className={"sr-only"}>
          {"Release type"}
        </label>
        <select id={"releaseType"}>
          <option value={""}>{"All types"}</option>
          <option value={"LN"}>{"Light novels (LN)"}</option>
          <option value={"Manga"}>{"Manga"}</option>
        </select>
        <button
          id={"hideSpecialReleases"}
          className={"btn"}
          type={"button"}
          aria-pressed={"false"}
          aria-controls={"releaseList"}
        >
          {"Hide special editions"}
        </button>
      </div>
      <p
        id={"releaseOwnershipSummary"}
        className={"release-note"}
        role={"status"}
      ></p>
      <div className={"list-label"}>
        <span id={"releaseResultCount"} role={"status"}>
          {"Checking publishers…"}
        </span>
      </div>
      <div id={"releaseList"} className={"release-grid"}></div>
    </section>
  );
}
