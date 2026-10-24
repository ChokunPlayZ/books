export type BookField =
  | "isbn"
  | "series"
  | "type"
  | "publisher"
  | "status"
  | "volume"
  | "source"
  | "price"
  | "date"
  | "note";

export type Book = {
  isbn: string;
  series: string;
  type: string;
  publisher: string;
  status: string;
  volume: number | "";
  source: string;
  price: number | "";
  date: string;
  note: string;
  coverUrl: string;
  publisherUrl: string;
  coverId?: string;
};

export type StoredBook = Book & {
  row: number;
  token: string;
};

export type ImportReview = {
  fingerprint: string;
  books: number;
  trash: number;
  savedReleases: number;
  seriesCatalogs: number;
  warnings: string[];
  sample: Book[];
};

export type ImportResult = {
  books: number;
  alreadyImported?: boolean;
};

export type Release = {
  id: string;
  publisherId: string;
  publisher: string;
  title: string;
  series: string;
  volume: number | "";
  type: string;
  url: string;
  isbn: string;
  price: number | "";
  special: boolean;
  bundle: boolean;
  availability: string;
  coverUrl?: string;
  coverId?: string;
  catalogSeries?: string;
  catalogVariant?: boolean;
  source?: string;
  variantGroup?: boolean;
};
