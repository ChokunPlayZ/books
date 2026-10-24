import { attr, luckpimItem } from "../../domain.ts";
import { SCRAPE_TTL } from "../scrape-cache.ts";
import type { ScraperContext, ScraperDefinition } from "./types.ts";

export const luckpim: ScraperDefinition = {
  id: "luckpim",
  hosts: ["www.luckpim.com"],
  create({ scrapeCache, requestRemote }: ScraperContext) {
    async function fetchLuckpimSeries_(url, refresh = false) {
      // Cache public book records, never the token/cookie handshake.
      return scrapeCache.get(
        "luckpim-series:" + url,
        { maxAge: SCRAPE_TTL.catalog, refresh },
        () => loadLuckpimSeries_(url),
      );
    }

    async function loadLuckpimSeries_(url) {
      const keyword = decodeURIComponent(url.split("?k=")[1]),
        session = await luckpimSession_("https://www.luckpim.com/");
      const result = await requestRemote(
        "https://www.luckpim.com/get/search_pin/key?page=1&limit=-1&keyword=" +
          encodeURIComponent(keyword),
        { headers: session },
      );
      if (result.status !== 200) throw new Error("Series search unavailable");
      const response = JSON.parse(result.body),
        data = response.data;
      if (
        response.status !== 200 ||
        !data ||
        !Array.isArray(data.list) ||
        !Number.isSafeInteger(data.total) ||
        data.total < 0
      )
        throw new Error("Series search changed");
      const items = data.list.map(luckpimItem).filter(Boolean);
      return {
        items: items,
        total: data.total,
        pages: 1,
        complete: items.length === data.total,
        search: true,
      };
    }

    async function luckpimSession_(url) {
      const response = await requestRemote(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (response.status !== 200) throw new Error("Catalog unavailable");
      const tag =
          /<input\b[^>]*name=["']?__RequestVerificationToken["']?[^>]*>/i.exec(
            response.body,
          ),
        token = tag && attr(tag[0], "value");
      if (!token) throw new Error("Catalog token unavailable");
      const headers = response.headers,
        cookieHeader = headers["Set-Cookie"] || headers["set-cookie"] || [];
      return {
        "XSRF-TOKEN": token,
        Cookie: (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader])
          .map(function (v) {
            return String(v).split(";")[0];
          })
          .join("; "),
      };
    }

    async function fetchLuckpim_(refresh = false) {
      return scrapeCache.get(
        "luckpim-releases",
        { maxAge: SCRAPE_TTL.releases, refresh },
        loadLuckpim_,
      );
    }

    async function loadLuckpim_() {
      const session = await luckpimSession_(
        "https://www.luckpim.com/product/list/new",
      );
      let items = [];
      for (let page = 1; page <= 2; page++) {
        const result = await requestRemote(
          "https://www.luckpim.com/_api/getBookList?setting=new&page=" +
            page +
            "&limit=100",
          {
            headers: session,
          },
        );
        if (result.status !== 200) throw new Error("Catalog unavailable");
        const data = JSON.parse(result.body);
        if (data.sc !== 200 || !data.d || !Array.isArray(data.d.data))
          throw new Error("Catalog changed");
        data.d.data.forEach(function (book) {
          const item = luckpimItem(book);
          if (item) items.push(item);
        });
        if (page * 100 >= Number(data.d.total) || data.d.data.length < 100)
          break;
      }
      return items;
    }

    return {
      releases: fetchLuckpim_,
      catalog: fetchLuckpimSeries_,
      searchSeriesUrl: (series) =>
        "https://www.luckpim.com/search_result?k=" + encodeURIComponent(series),
    };
  },
};
