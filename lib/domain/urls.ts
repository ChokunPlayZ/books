import { decodeHtml } from "./html.ts";

// The former thailand.kinokuniya.com storefront now redirects here.
export function kinokuniyaSearchUrl(query: string): string {
  return (
    "https://kinokuniya.co.th/search?type=product&q=" +
    encodeURIComponent(query)
  );
}

export function safeSeriesCatalogUrl(raw, id) {
  const url = decodeHtml(String(raw || "").trim());
  if (id === "dexpress") {
    try {
      const parsed = new URL(url);
      if (
        parsed.origin !== "https://www.dexpress-shop.com" ||
        parsed.username ||
        parsed.password ||
        parsed.hash
      )
        return "";
      const category = /^\/category\/(\d+)(?:\/[^?#]*)?\/?$/.exec(
        parsed.pathname,
      );
      if (category && !parsed.search)
        return parsed.origin + "/category/" + category[1];
      if (
        parsed.pathname === "/search" &&
        [...parsed.searchParams.keys()].join() === "q"
      ) {
        const query = parsed.searchParams.get("q").trim();
        if (query && query.length <= 500)
          return parsed.origin + "/search?q=" + encodeURIComponent(query);
      }
    } catch {}
    return "";
  }
  if (id === "animag") {
    const category =
      /^https:\/\/www\.animagshop\.com\/category\/(\d+)(?:\/[^?#]*)?\/?$/.exec(
        url,
      );
    if (category) return "https://www.animagshop.com/category/" + category[1];
  }
  if (
    id === "yenpress" &&
    /^https:\/\/yenpress\.com\/series\/[a-zA-Z0-9-]+\/?$/.test(url)
  )
    return url.replace(/\/$/, "");
  if (
    id === "phoenix" &&
    /^https:\/\/www\.phoenixnext\.com\/book-series\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.html$/.test(
      url,
    )
  )
    return url;
  const first =
    id === "firstpage" &&
    /^https:\/\/www\.firstpagepro\.com\/category\/(\d+)(?:\/[^?#]*)?\/?$/.exec(
      url,
    );
  if (first) return "https://www.firstpagepro.com/category/" + first[1];
  if (
    id === "luckpim" &&
    /^https:\/\/www\.luckpim\.com\/search_result\?k=[^&#]+$/.test(url)
  ) {
    try {
      const keyword = decodeURIComponent(url.split("?k=")[1]).trim();
      return keyword && keyword.length <= 500
        ? "https://www.luckpim.com/search_result?k=" +
            encodeURIComponent(keyword)
        : "";
    } catch (error) {}
  }
  if (id === "yaakz") {
    try {
      const parsed = new URL(url);
      if (
        parsed.origin !== "https://www.yaakz.com" ||
        parsed.username ||
        parsed.password ||
        parsed.hash
      )
        return "";
      if (
        /^\/category\/(?:[^/?#]+\/)*\d+\/?$/.test(parsed.pathname) &&
        !parsed.search
      )
        return parsed.origin + parsed.pathname.replace(/\/$/, "");
      if (
        parsed.pathname === "/search" &&
        [...parsed.searchParams.keys()].join() === "q"
      ) {
        const query = parsed.searchParams.get("q").trim();
        if (query && query.length <= 500)
          return parsed.origin + "/search?q=" + encodeURIComponent(query);
      }
    } catch {}
  }
  return "";
}

export function publisherCatalogSource(raw) {
  const url = decodeHtml(String(raw || "").trim());
  for (const id of [
    "phoenix",
    "firstpage",
    "yaakz",
    "yenpress",
    "animag",
    "dexpress",
  ]) {
    const category = safePublisherTitleUrl(url, id);
    if (category) return { publisherId: id, url: category };
  }
  if (
    /^https:\/\/www\.phoenixnext\.com\/(?:gl|bl|manga|light-novel|book-series)\.html$/.test(
      url,
    )
  )
    return { publisherId: "phoenix", url };
  if (
    url === "https://www.firstpagepro.com/" ||
    url === "https://www.firstpagepro.com"
  )
    return { publisherId: "firstpage", url: "https://www.firstpagepro.com/" };
  if (url === "https://www.yaakz.com/" || url === "https://www.yaakz.com")
    return { publisherId: "yaakz", url: "https://www.yaakz.com/" };
  if (url === "https://yenpress.com/" || url === "https://yenpress.com")
    return { publisherId: "yenpress", url: "https://yenpress.com/" };
  if (
    /^https:\/\/www\.animagshop\.com\/?$/.test(url) ||
    url === "https://www.animagshop.com/category"
  )
    return { publisherId: "animag", url: "https://www.animagshop.com/" };
  if (
    url === "https://www.dexpress-shop.com/" ||
    url === "https://www.dexpress-shop.com"
  )
    return { publisherId: "dexpress", url: "https://www.dexpress-shop.com/" };
  throw new Error(
    "Use a DEXpress, Animag, Phoenix Next, First Page Pro, Yaakz or Yen Press category or series URL.",
  );
}

export function safePublisherTitleUrl(raw, id) {
  const url = decodeHtml(String(raw || ""));
  if (
    id === "phoenix" &&
    /^https:\/\/www\.phoenixnext\.com\/(?:book-series|gl|bl|manga|light-novel)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.html$/.test(
      url,
    )
  )
    return url;
  return safeSeriesCatalogUrl(url, id);
}

export function safeCoverUrl(raw, base?: string) {
  if (Array.isArray(raw)) raw = raw[0];
  if (raw && typeof raw === "object") raw = raw.url || raw.contentUrl;
  if (!raw) return "";
  try {
    const url = new URL(decodeHtml(String(raw)), base);
    const host = url.hostname;
    const allowed = [
      "www.phoenixnext.com",
      "www.firstpagepro.com",
      "www.luckpim.com",
      "www.yaakz.com",
      "books.google.com",
      "books.googleusercontent.com",
      "covers.openlibrary.org",
      "images.yenpress.com",
      "kinokuniya.co.th",
    ];
    if (
      !allowed.includes(host) &&
      !/^(?:[a-z0-9-]+\.)*(?:naiin\.com|lnwfile\.com)$/.test(host)
    )
      return "";
    if (host === "kinokuniya.co.th" && !url.pathname.startsWith("/cdn/shop/"))
      return "";
    if (url.protocol === "http:") url.protocol = "https:";
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.href.length > 2000
    )
      return "";
    return url.href;
  } catch {
    return "";
  }
}

export function publisherKey(name) {
  const key = String(name || "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "");
  if (/phoenix|ฟีนิกซ์/.test(key)) return "phoenix";
  if (/firstpage|เฟิร์สเพจ/.test(key)) return "firstpage";
  if (
    /^(?:dexpress|dex|เดกซ์เพรส|เดกซ์เพรสส์|เด็กซ์เพรส|เด็กซ์เพรสส์)$/.test(key)
  )
    return "dexpress";
  if (/luckpim|รักพิมพ์/.test(key)) return "luckpim";
  if (/yaakz|siaminter|สยามอินเตอร์|^sic$/.test(key)) return "yaakz";
  if (/^(?:yenpress|yenon|izepress|jy)$/.test(key)) return "yenpress";
  if (
    /animag|อนิแม็ก|อนิแมก|^(?:aplus|gplus|agbook|agbooks|agcomic|agcomics|beloved|เอพลัส|จีพลัส|บีเลิฟด์พลัส)$/.test(
      key,
    )
  )
    return "animag";
  return key;
}

export function safePublisherUrl(raw, publisher) {
  if (!raw) return "";
  try {
    const url = new URL(String(raw).trim());
    const id = publisherKey(publisher);
    const hosts = {
      phoenix: "www.phoenixnext.com",
      firstpage: "www.firstpagepro.com",
      luckpim: "www.luckpim.com",
      yaakz: "www.yaakz.com",
      yenpress: "yenpress.com",
      animag: "www.animagshop.com",
      dexpress: "www.dexpress-shop.com",
    };
    if (
      url.protocol !== "https:" ||
      (hosts[id] && url.hostname !== hosts[id]) ||
      url.username ||
      url.password ||
      url.port ||
      url.href.length > 2000
    )
      return "";
    return url.href;
  } catch {
    return "";
  }
}

export function safeProductUrl(raw, id) {
  const url = decodeHtml(String(raw || ""));
  const patterns = {
    phoenix: /^https:\/\/www\.phoenixnext\.com\/[a-zA-Z0-9_-]+\.html$/,
    firstpage:
      /^https:\/\/www\.firstpagepro\.com\/product\/(\d+)(?:\/[^?#]*)?$/,
    yaakz: /^https:\/\/www\.yaakz\.com\/product\/(?:[^/?#]+\/)*\d+\/?$/,
    luckpim: /^https:\/\/www\.luckpim\.com\/product\/detail\/\d+\/?$/,
    yenpress: /^https:\/\/yenpress\.com\/titles\/\d{13}-[a-zA-Z0-9-]+\/?$/,
    animag:
      /^https:\/\/www\.animagshop\.com\/product\/(\d+)(?:\/[^?#]*)?(?:\?pid=(\d+))?$/,
    dexpress:
      /^https:\/\/www\.dexpress-shop\.com\/product\/(\d+)(?:\/[^?#]*)?(?:\?pid=(\d+))?$/,
  };
  if (!patterns[id] || !patterns[id].test(url)) return "";
  if (id === "yaakz")
    return (
      "https://www.yaakz.com/product/" + url.replace(/\/$/, "").split("/").pop()
    );
  if (id === "firstpage" || id === "animag" || id === "dexpress")
    return (
      new URL(url).origin +
      "/product/" +
      url.match(patterns[id])[1] +
      ((id === "animag" || id === "dexpress") && url.match(patterns[id])[2]
        ? "?pid=" + url.match(patterns[id])[2]
        : "")
    );
  return url.replace(/\/$/, "");
}
