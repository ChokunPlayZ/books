import { canonicalIsbn } from "../domain.ts";
import type { Store } from "./store.ts";
import { AppError } from "./store.ts";
import type { createCatalogService } from "./catalogs.ts";
import type { createCoverService } from "./covers.ts";

export type ImportDiscoveryBatch = {
  firstRow: number;
  lastRow: number;
  afterRow: number;
};

export function createImportDiscovery(
  store: Store,
  catalogs: ReturnType<typeof createCatalogService>,
  covers: ReturnType<typeof createCoverService>,
) {
  return async (request: ImportDiscoveryBatch) =>
    store.deferMetadataFill(async () => {
      if (
        !request ||
        ![request.firstRow, request.lastRow, request.afterRow].every(
          Number.isSafeInteger,
        ) ||
        request.firstRow < 1 ||
        request.lastRow < request.firstRow ||
        request.afterRow < 0
      )
        throw new AppError("Choose an imported book batch.");
      const books = await store.importDiscoveryBatch(request);
      const batch = books.slice(0, 25);
      let discovered = 0,
        filled = 0;
      const warnings = new Set<string>();
      // Sequential series discovery is intentional: the first book finds a category,
      // and all siblings then reuse it. The queue provides global concurrency.
      for (const book of batch) {
        if (
          canonicalIsbn(book.isbn) &&
          book.publisher &&
          book.publisherUrl &&
          (book.coverId || book.coverUrl) &&
          book.pageCount &&
          book.msrp !== "" &&
          book.msrp != null
        )
          continue;
        let details;
        if (book.volume !== "") {
          const result = await catalogs.lookupBook({
            series: book.series,
            volume: book.volume,
            publisher: book.publisher,
            type: book.type === "Others" && !book.edition ? "" : book.type,
            edition: book.edition,
            isbn: book.isbn,
          });
          for (const warning of result.warnings) warnings.add(warning);
          details = result.details;
          // Ambiguous formats/editions are for the owner to review, never guessed.
          if (result.needsSelection) continue;
        }
        const isbn = canonicalIsbn(book.isbn);
        if (!details && isbn) {
          const result = await catalogs.lookupIsbn(isbn);
          for (const warning of result.warnings) warnings.add(warning);
          if (result.found && !result.stale)
            details = { ...result.details, isbn, isbnVerified: true };
        }
        if (!details) continue;
        discovered++;
        let coverId = "";
        if (!book.coverId && !book.coverUrl && details.coverUrl) {
          try {
            coverId = (await covers.ensure(details.coverUrl)).id;
          } catch {
            warnings.add("Some cover images could not be downloaded.");
          }
        }
        if (await store.fillDiscoveredBook(book, details, coverId)) filled++;
      }
      return {
        discovered,
        filled,
        warnings: [...warnings],
        next:
          books.length > batch.length
            ? { ...request, afterRow: batch.at(-1).row }
            : null,
      };
    });
}
