export const BOOK_APP = Object.freeze({
  headers: [
    "ISBN",
    "Series",
    "Type",
    "Publisher",
    "Status",
    "Volume",
    "Source",
    "Price",
    "Date",
    "Note",
  ],
  fields: [
    "isbn",
    "series",
    "type",
    "publisher",
    "status",
    "volume",
    "source",
    "price",
    "date",
    "note",
  ],
  statuses: ["Sealed", "Un Sealed", "Reading", "Read"],
  types: [
    "LN (EN)",
    "Manga (JP) (Color)",
    "Manga (TH)",
    "LN (TH)",
    "Manga (JP)",
    "Manga (TH) (Color)",
    "Other",
  ],
});

export const PUBLISHERS = Object.freeze([
  {
    id: "yaakz",
    name: "Siam Inter Comics (Yaakz)",
    url: "https://www.yaakz.com/category/new-arrivals-best-sellers/976",
    scope: "Yaakz new arrivals, including individual volume variants",
  },
  {
    id: "phoenix",
    name: "Phoenix Next",
    url: "https://www.phoenixnext.com/new-release.html",
    scope: "Latest 72 catalog listings",
  },
  {
    id: "firstpage",
    name: "First Page Pro",
    url: "https://www.firstpagepro.com/showroom/new",
    scope: "Latest 40 catalog listings",
  },
  {
    id: "luckpim",
    name: "Luckpim",
    url: "https://www.luckpim.com/product/list/new",
    scope: "Monthly new releases, up to 200 listings",
  },
]);
