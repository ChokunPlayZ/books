import {
  attr,
  splitBookTitle,
  splitFirstPageTitle,
  textHtml,
} from "../../domain.ts";
import { httpFailure, ScrapeFailure } from "../scrape-diagnostics.ts";
import type { ScraperContext } from "./types.ts";

function titles(values: unknown[]) {
  if (values.some((value) => typeof value !== "string" || !value.trim()))
    throw new Error("Query completion data changed.");
  return (values as string[]).slice(0, 100).map(textHtml);
}

async function completionJson(
  context: Pick<ScraperContext, "requestRemote">,
  url: string,
) {
  // The high-level completion cache keeps parsed public names. Do not retain
  // raw API payloads or duplicate a user's typed query in a page-cache record.
  const response = await context.requestRemote(url);
  if (response.status !== 200) throw httpFailure(response.url, response.status);
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw new ScrapeFailure({
      kind: "parser",
      url,
      status: 200,
      message: "Query completion returned invalid JSON.",
    });
  }
}

export function phoenixSuggestions(context: ScraperContext) {
  return async (query: string) => {
    const data = await completionJson(
      context,
      "https://www.phoenixnext.com/seriesbrands/ajax/searchbrands/?query=" +
        encodeURIComponent(query),
    );
    if (!Array.isArray(data))
      throw new Error("Phoenix completion data changed.");
    return titles(data.map((item) => item?.brand_name)).flatMap((title) => {
      // Phoenix appends a romanized title to its Thai brand label. Both are
      // source-provided names; do not submit the concatenation as one query.
      const bilingual =
        /^(.+[\p{Script=Thai}\p{M}])\s+([A-Za-z][^\p{Script=Thai}]+)$/u.exec(
          title,
        );
      return bilingual ? [bilingual[1], bilingual[2]] : [title];
    });
  };
}

export function naiinSuggestions(
  context: Pick<ScraperContext, "requestRemote">,
) {
  return async (query: string) => {
    const data = await completionJson(
      context,
      "https://www.naiin.com/autocomplete?query=" + encodeURIComponent(query),
    );
    if (!Array.isArray(data)) throw new Error("Naiin completion data changed.");
    if (data.some((item) => !item || typeof item.GroupName !== "string"))
      throw new Error("Naiin completion data changed.");
    return titles(
      data
        .filter(
          (item) => item.GroupName === "Product" && item.RefCode !== "000000",
        )
        .map((item) => item.RefName),
    ).map((title) => splitBookTitle(title).series);
  };
}

export function lnwSuggestions(
  context: ScraperContext,
  id: string,
  origin: string,
) {
  return async (query: string) => {
    const response = await context.requestRemote(origin + "/search/box", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({ q: query }).toString(),
    });
    if (response.status !== 200)
      throw httpFailure(response.url, response.status);
    const items: string[] = [];
    for (const match of response.body.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
      const href = attr(match[0], "href");
      if (
        !href.startsWith(origin + "/p/") ||
        !/^\d+$/.test(href.slice((origin + "/p/").length))
      )
        continue;
      const image = /<img\b[^>]*>/i.exec(match[0]);
      const title = image && attr(image[0], "alt");
      if (!title) throw new Error("Completion title unavailable.");
      items.push(
        id === "firstpage"
          ? splitFirstPageTitle(title).series
          : splitBookTitle(title).series,
      );
    }
    if (
      !items.length &&
      response.body.trim() &&
      !/ไม่พบสินค้า|ไม่พบข้อมูล|no results/i.test(textHtml(response.body))
    )
      throw new Error("Query completion markup changed.");
    return titles(items);
  };
}
