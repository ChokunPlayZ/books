import { $, node } from "./dom.ts";
import { createInfiniteList } from "./infinite-list.ts";
import { seriesPath } from "../domain/navigation.ts";
import {
  animeSeasonLabel,
  animeStatus,
  animeTitleKey,
  type AnimeMedia,
  type AdaptationFeed,
  type SeasonalFeed,
} from "../domain/anime.ts";
import type { StoredBook } from "../types.ts";

type Bindings = {
  rpc: (name: string, arg?: unknown) => Promise<unknown>;
  signal: AbortSignal;
  books: () => StoredBook[];
  addBook: (defaults: { series: string; type: string }) => void;
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
  loadPublisher,
  savePreferences,
}: Bindings) {
  let seasonFeed: SeasonalFeed | null = null;
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

  function renderSeason() {
    if (!$("animeSeasonList")) return;
    seasonalList ??= createInfiniteList($("animeSeasonList"));
    const query = $("animeSeasonSearch").value.trim().toLocaleLowerCase();
    const type = $("animeBookType").value,
      status = $("animeAiring").value;
    const items = (seasonFeed?.items || []).flatMap((item) => {
      if (type && item.book.kind !== type) return [];
      const appearances = item.appearances.filter(
        (entry) => !status || entry.anime.status === status,
      );
      if (!appearances.length) return [];
      const titles = [
        ...item.book.titles,
        ...appearances.flatMap((entry) => entry.anime.titles),
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
        ]),
        label: "books",
      },
    );
    if (!seasonFeed) return;
    $("animeSeasonStatus").textContent =
      `${animeSeasonLabel(seasonFeed.season, seasonFeed.year)} · ${items.length} books · ${seasonFeed.stale ? "Previous check" : "Checked"} ${new Date(seasonFeed.checkedAt).toLocaleString()}` +
      (seasonFeed.warning ? " · " + seasonFeed.warning : "");
    if (!items.length)
      $("animeSeasonList").append(
        node(
          "p",
          "empty",
          "No linked books match these filters. Try another type, status, search or season.",
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
    $("animeSeasonStatus").textContent = "Checking this season on AniList…";
    $("animeSeasonList").setAttribute("aria-busy", "true");
    $("refreshAnimeSeason").disabled = true;
    try {
      const result = (await rpc("getSeasonalAnimeBooks", {
        season,
        year,
        refresh,
      })) as SeasonalFeed;
      if (signal.aborted || generation !== seasonGeneration) return;
      seasonFeed = result;
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
  (["animeBookType", "animeAiring", "animeSeasonSearch"] as const).forEach(
    (id) =>
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
