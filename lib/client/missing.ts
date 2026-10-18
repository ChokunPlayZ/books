import { $, node, number } from "./dom.ts";
import { createInfiniteList } from "./infinite-list.ts";
import { collectionGaps, missingSummary, seriesGaps } from "./matching.ts";
import { seriesPath } from "../domain/navigation.ts";
import type { StoredBook } from "../types.ts";

export function createMissingBrowser(
  addVolume: (
    series: string,
    edition: ReturnType<typeof seriesGaps<StoredBook>>[number],
    volume: number,
  ) => void,
) {
  if (!$("missingList")) return null;
  const list = createInfiniteList($("missingList"));

  return {
    render(books: StoredBook[]) {
      const search = $("missingSearch").value.trim().toLocaleLowerCase();
      const groups = collectionGaps(books).filter((group) =>
        [
          group.series,
          ...group.editions.flatMap((edition) => [
            edition.type,
            edition.publisher,
          ]),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search),
      );
      if ($("missingSort").value === "missing")
        groups.sort(
          (a, b) => b.missing - a.missing || a.series.localeCompare(b.series),
        );
      $("missingSummary").textContent = missingSummary(groups);
      list.render(
        groups,
        (group) => {
          const card = node("article", "missing-series");
          const heading = node("header", "missing-series-heading");
          const title = node("h2");
          const titleLink = node("a", "", group.series);
          titleLink.href = seriesPath(group.series);
          title.append(titleLink);
          heading.append(
            title,
            node("span", "missing-total", number(group.missing) + " missing"),
          );
          card.append(heading);
          for (const edition of group.editions) {
            const row = node("div", "missing-series-edition");
            row.append(
              node(
                "h3",
                "",
                [edition.type, edition.publisher].filter(Boolean).join(" · ") ||
                  "Edition not recorded",
              ),
              node(
                "p",
                "hint",
                `Missing ${number(edition.missing)} ${edition.missing === 1 ? "volume" : "volumes"} through volume ${number(edition.highest)}`,
              ),
            );
            const ranges = node("div", "missing-ranges");
            ranges.setAttribute("aria-label", "Missing volumes");
            for (const [from, to] of edition.ranges) {
              const add = node(
                "button",
                "btn missing-volume",
                `Vol. ${from}${to > from ? "–" + to : ""} +`,
              );
              add.type = "button";
              add.setAttribute(
                "aria-label",
                `Add missing volume ${from} of ${group.series}, ${[edition.type, edition.publisher].filter(Boolean).join(", ")}`,
              );
              add.onclick = () => addVolume(group.series, edition, from);
              ranges.append(add);
            }
            row.append(ranges);
            card.append(row);
          }
          const link = node(
            "a",
            "missing-series-link",
            "View series & catalog →",
          );
          link.href = seriesPath(group.series);
          card.append(link);
          return card;
        },
        {
          key: JSON.stringify([search, $("missingSort").value]),
          label: "series",
        },
      );
      if (!groups.length) {
        const empty = node("div", "empty");
        empty.append(
          node(
            "h2",
            "",
            search
              ? "No matching series"
              : books.length
                ? "No shelf gaps found"
                : "Your shelf starts here",
          ),
          node(
            "p",
            "",
            search
              ? "Try another series, type or publisher."
              : books.length
                ? "Your numbered editions have no whole-volume gaps. Series catalogs can help you find newer volumes."
                : "Add numbered volumes to your collection to see what’s missing.",
          ),
        );
        const link = node("a", "btn", "View collection");
        link.href = "/";
        empty.append(link);
        $("missingList").append(empty);
      }
    },
    dispose() {
      list.dispose();
    },
  };
}
