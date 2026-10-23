import { $, node } from "./dom.ts";
import { createInfiniteList } from "./infinite-list.ts";
import { seriesPath } from "../domain/navigation.ts";
import {
  animeSeasonLabel,
  animeStatus,
  animeTitleKey,
  animeCatalogTitleKeys,
  type AnimeMedia,
  type AdaptationFeed,
  type SeasonalThaiFeed,
  type ThaiAnimeEdition,
} from "../domain/anime.ts";
import { canonicalIsbn } from "../domain/isbn.ts";
import { publisherKey } from "../domain/urls.ts";
import type { Release, StoredBook } from "../types.ts";

type Bindings = {
  rpc: (name: string, arg?: unknown) => Promise<unknown>;
  signal: AbortSignal;
  books: () => StoredBook[];
  addBook: (defaults: { series: string; type: string }) => void;
  addEdition: (item: Release) => void;
  loadPublisher: () => void;
  savePreferences: () => void;
};

function link(label: string, url: string) {
  const anchor = node("a", "anime-link", label);
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function mediaLinks(media: AnimeMedia) {
  const links = node("div", "anime-links");
  links.append(link("AniList ↗", media.url));
  if (media.malUrl) links.append(link("MyAnimeList ↗", media.malUrl));
  return links;
}

function animeEntry(media: AnimeMedia) {
  const item = node("li", "anime-entry");
  item.append(link(media.title + " ↗", media.url));
  item.append(
    node(
      "span",
      "hint",
      [
        animeStatus(media.status),
        media.season && media.year
          ? animeSeasonLabel(media.season, media.year)
          : "",
        media.format.replaceAll("_", " "),
      ]
        .filter(Boolean)
        .join(" · "),
    ),
  );
  if (media.malUrl) item.append(link("MAL ↗", media.malUrl));
  return item;
}

export function createAnimeBrowser({
  rpc,
  signal,
  books,
  addBook,
  addEdition,
  loadPublisher,
  savePreferences,
}: Bindings) {
  let seasonFeed: SeasonalThaiFeed | null = null;
  let seasonGeneration = 0,
    adaptationGeneration = 0;
  let ready = false;
  let seasonalList: ReturnType<typeof createInfiniteList> | null = null;

  function ownership(media: AnimeMedia) {
    const titles = new Set(media.titles.map(animeTitleKey));
    return books().find(
      (book) =>
        titles.has(animeTitleKey(book.series)) &&
        (media.kind === "LN"
          ? /^LN\b/i.test(book.type)
          : /^Manga\b/i.test(book.type)),
    );
  }

  function thaiOwnership(media: AnimeMedia, edition: Release) {
    const titles = new Set([
      ...media.titles.flatMap((title) => [...animeCatalogTitleKeys(title)]),
      ...animeCatalogTitleKeys(edition.series),
    ]);
    const isbn = canonicalIsbn(edition.isbn);
    return books().find(
      (book) =>
        (isbn && canonicalIsbn(book.isbn) === isbn) ||
        (book.type === edition.type &&
          publisherKey(book.publisher) === publisherKey(edition.publisher) &&
          [...animeCatalogTitleKeys(book.series)].some((title) =>
            titles.has(title),
          )),
    );
  }

  function thaiEdition(media: AnimeMedia, edition: ThaiAnimeEdition) {
    const { item } = edition;
    const row = node("div", "anime-thai-edition");
    row.append(
      node("p", "release-match", "Thai edition"),
      node("h4", "", item.series),
    );
    row.append(
      node(
        "p",
        "release-meta",
        [
          item.publisher,
          item.type === "LN (TH)" ? "Light novel · Thai" : "Manga · Thai",
          item.volume !== "" ? "Volume " + item.volume : "",
          item.availability,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    row.append(link("Publisher book page ↗", item.url));
    row.append(
      node(
        "p",
        "hint",
        `Matched by ${edition.matchedBy}: ${edition.matchedTitle}. ${edition.stale ? "Previous check" : "Checked"} ${new Date(edition.checkedAt).toLocaleDateString()}.`,
      ),
    );
    const actions = node("div", "anime-actions");
    const owned = thaiOwnership(media, item);
    if (owned) {
      const view = node("a", "btn", "On your shelf · View series");
      view.href = seriesPath(owned.series);
      actions.append(view);
    }
    const add = node(
      "button",
      "btn" + (owned ? "" : " primary"),
      "Add Thai edition",
    );
    add.type = "button";
    add.addEventListener(
      "click",
      () => addEdition({ ...item, series: owned?.series || item.series }),
      { signal },
    );
    actions.append(add);
    row.append(actions);
    return row;
  }

  function renderSeason() {
    if (!$("animeSeasonList")) return;
    seasonalList ??= createInfiniteList($("animeSeasonList"));
    const query = $("animeSeasonSearch").value.trim().toLocaleLowerCase();
    const type = $("animeBookType").value,
      status = $("animeAiring").value,
      translation = $("animeTranslation").value;
    const items = (seasonFeed?.items || []).flatMap((item) => {
      if (type && item.book.kind !== type) return [];
      if (translation === "available" && !item.thaiEditions.length) return [];
      const appearances = item.appearances.filter(
        (entry) => !status || entry.anime.status === status,
      );
      if (!appearances.length) return [];
      const titles = [
        ...item.book.titles,
        ...appearances.flatMap((entry) => entry.anime.titles),
        ...item.thaiEditions.flatMap((edition) => [
          edition.item.series,
          edition.item.title,
          edition.item.publisher,
        ]),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return query && !titles.includes(query) ? [] : [{ ...item, appearances }];
    });
    seasonalList.render(
      items,
      (item) => {
        const card = node("article", "anime-card");
        card.append(
          node(
            "p",
            "eyebrow",
            item.book.kind === "LN" ? "Light novel" : "Manga",
          ),
          node("h3", "", item.book.title),
        );
        card.append(mediaLinks(item.book));
        const appearances = node("ul", "anime-entries");
        for (const entry of item.appearances) {
          const row = animeEntry(entry.anime);
          row.prepend(
            node(
              "span",
              "release-match",
              entry.relation === "SOURCE"
                ? "Source material"
                : item.book.kind === "Manga"
                  ? "Manga adaptation"
                  : "Novel adaptation",
            ),
          );
          appearances.append(row);
        }
        card.append(appearances);
        if (item.thaiEditions.length) {
          item.thaiEditions.forEach((edition) =>
            card.append(thaiEdition(item.book, edition)),
          );
          return card;
        }
        card.append(
          node(
            "p",
            "hint",
            "No Thai edition matched in the checked catalogs. Try the publisher’s site or choose your edition manually.",
          ),
        );
        const actions = node("div", "anime-actions"),
          owned = ownership(item.book);
        if (owned) {
          const view = node("a", "btn", "On your shelf · View series");
          view.href = seriesPath(owned.series);
          actions.append(view);
        }
        const add = node(
          "button",
          "btn" + (owned ? "" : " primary"),
          owned ? "Add a volume" : "Pick this book",
        );
        add.type = "button";
        add.addEventListener(
          "click",
          () =>
            addBook({
              series: owned?.series || item.book.title,
              type:
                owned?.type ||
                (item.book.kind === "LN" ? "LN (TH)" : "Manga (TH)"),
            }),
          { signal },
        );
        actions.append(add);
        card.append(
          actions,
          node(
            "p",
            "hint",
            "Choose your edition, volume and publisher before saving.",
          ),
        );
        return card;
      },
      {
        key: JSON.stringify([
          seasonFeed?.season,
          seasonFeed?.year,
          query,
          type,
          status,
          translation,
        ]),
        label: "books",
      },
    );
    if (!seasonFeed) return;
    $("animeSeasonStatus").textContent =
      `${animeSeasonLabel(seasonFeed.season, seasonFeed.year)} · ${items.length} ${items.length === 1 ? "book" : "books"} · ${items.filter((item) => item.thaiEditions.length).length} with Thai editions · AniList ${seasonFeed.stale ? "Previous check" : "checked"} ${new Date(seasonFeed.checkedAt).toLocaleString()}` +
      (seasonFeed.warning ? " · " + seasonFeed.warning : "");
    if (!items.length)
      $("animeSeasonList").append(
        node(
          "p",
          "empty",
          translation === "available"
            ? "No matched Thai editions for these filters. Try All linked books, another search or season. Check catalog coverage above for unavailable sources."
            : "No linked books match these filters. Try another type, status, search or season.",
        ),
      );
  }

  async function loadSeason(refresh = false) {
    if (!$("animeYear").reportValidity() || !$("animeYear").value) return;
    const generation = ++seasonGeneration;
    const season = $("animeSeason").value,
      year = Number($("animeYear").value);
    seasonFeed = null;
    renderSeason();
    $("animeSeasonError").hidden = true;
    $("animeThaiSources").replaceChildren();
    $("animeSeasonStatus").textContent =
      "Checking seasonal anime and matching Thai publisher catalogs…";
    $("animeSeasonList").setAttribute("aria-busy", "true");
    $("refreshAnimeSeason").disabled = true;
    try {
      const result = (await rpc("getSeasonalThaiBooks", {
        season,
        year,
        refresh,
      })) as SeasonalThaiFeed;
      if (signal.aborted || generation !== seasonGeneration) return;
      seasonFeed = result;
      for (const source of result.thaiSources) {
        const row = node("p", "hint");
        row.append(link(source.publisher + " ↗", source.url));
        row.append(
          document.createTextNode(
            " · " +
              (source.error ||
                (source.stale
                  ? "Previous check"
                  : source.complete
                    ? "Catalog checked"
                    : "Incomplete check")) +
              (source.checkedAt
                ? " · " + new Date(source.checkedAt).toLocaleString()
                : ""),
          ),
        );
        $("animeThaiSources").append(row);
      }
      renderSeason();
    } catch (error) {
      if (signal.aborted || generation !== seasonGeneration) return;
      $("animeSeasonError").textContent =
        error.message || "Seasonal books could not be loaded.";
      $("animeSeasonError").hidden = false;
      $("animeSeasonStatus").textContent = "Use Refresh season to try again.";
    } finally {
      if (generation === seasonGeneration) {
        $("refreshAnimeSeason").disabled = false;
        $("animeSeasonList").setAttribute("aria-busy", "false");
      }
    }
  }

  async function findAdaptations() {
    if (!$("adaptationForm").reportValidity()) return;
    const generation = ++adaptationGeneration;
    $("adaptationError").hidden = true;
    $("adaptationList").replaceChildren();
    $("adaptationStatus").textContent =
      "Checking book and anime relations on AniList…";
    $("adaptationSummary").textContent = "Checking AniList…";
    $("adaptationList").setAttribute("aria-busy", "true");
    $("findAdaptations").disabled = true;
    try {
      const result = (await rpc("getAnimeAdaptations", {
        search: $("adaptationSearch").value.trim(),
        type: $("adaptationType").value,
      })) as AdaptationFeed;
      if (signal.aborted || generation !== adaptationGeneration) return;
      const items = result.exactId
        ? result.items.filter((item) => item.book.id === result.exactId)
        : result.items;
      const count = items.reduce((total, item) => total + item.anime.length, 0);
      $("adaptationSummary").textContent = !items.length
        ? "No title match"
        : !result.exactId
          ? "Review possible matches"
          : count
            ? `${count} linked anime`
            : "No linked anime found";
      $("adaptationStatus").textContent =
        (result.exactId
          ? "Title match on AniList."
          : items.length
            ? "Possible title matches. Check the book title and format before relying on its adaptation details."
            : "No matching book found. Try its original or English title.") +
        ` ${result.stale ? "Previous check" : "Checked"} ${new Date(result.checkedAt).toLocaleString()}.` +
        (result.warning ? " " + result.warning : "");
      for (const item of items) {
        const card = node("article", "anime-card");
        card.append(
          node(
            "p",
            "eyebrow",
            item.book.kind === "LN" ? "Light novel" : "Manga",
          ),
          node("h3", "", item.book.title),
          mediaLinks(item.book),
        );
        if (item.anime.length) {
          const list = node("ul", "anime-entries");
          item.anime.forEach((anime) => list.append(animeEntry(anime)));
          card.append(list);
        } else
          card.append(
            node(
              "p",
              "hint",
              "AniList has no directly linked anime adaptation for this entry. This does not rule out an adaptation.",
            ),
          );
        $("adaptationList").append(card);
      }
    } catch (error) {
      if (signal.aborted || generation !== adaptationGeneration) return;
      $("adaptationError").textContent =
        error.message || "Adaptation details could not be loaded.";
      $("adaptationError").hidden = false;
      $("adaptationStatus").textContent = "Search again to retry.";
      $("adaptationSummary").textContent = "AniList unavailable";
    } finally {
      if (generation === adaptationGeneration) {
        $("findAdaptations").disabled = false;
        $("adaptationList").setAttribute("aria-busy", "false");
      }
    }
  }

  function selectMode() {
    if (!$("discoveryMode")) return;
    const anime = $("discoveryMode").value === "anime";
    $("publisherDiscovery").hidden = anime;
    $("refreshDiscovery").hidden = anime;
    $("seasonalDiscovery").hidden = !anime;
    if (ready) {
      if (anime && !seasonFeed) void loadSeason();
      else if (!anime) loadPublisher();
    }
  }

  $("discoveryMode")?.addEventListener(
    "change",
    () => {
      selectMode();
      savePreferences();
    },
    { signal },
  );
  (["animeSeason", "animeYear"] as const).forEach((id) =>
    $(id)?.addEventListener(
      "change",
      () => {
        if (ready) void loadSeason();
      },
      { signal },
    ),
  );
  (
    [
      "animeBookType",
      "animeTranslation",
      "animeAiring",
      "animeSeasonSearch",
    ] as const
  ).forEach((id) =>
    $(id)?.addEventListener(
      id === "animeSeasonSearch" ? "input" : "change",
      () => {
        renderSeason();
        savePreferences();
      },
      { signal },
    ),
  );
  $("refreshAnimeSeason")?.addEventListener(
    "click",
    () => void loadSeason(true),
    { signal },
  );
  $("adaptationForm")?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      void findAdaptations();
    },
    { signal },
  );
  selectMode();

  return {
    start() {
      ready = true;
      selectMode();
      if ($("adaptationPanel")) {
        const types = new Set(
          books()
            .filter((book) => book.series === $("seriesTitle").textContent)
            .map((book) =>
              /^LN\b/i.test(book.type)
                ? "LN"
                : /^Manga\b/i.test(book.type)
                  ? "Manga"
                  : "",
            ),
        );
        if (types.size === 1) $("adaptationType").value = [...types][0];
        void findAdaptations();
      }
    },
    update() {
      if (seasonFeed) renderSeason();
    },
    dispose() {
      seasonalList?.dispose();
    },
  };
}
