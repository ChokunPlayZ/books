import type { CollectionView } from "../domain/navigation.ts";

export function createCollectionState() {
  return {
    data: null as ReturnType<
      import("../server/store").Store["api"]["getCollection"]
    > | null,
    view: "collection" as CollectionView,
    selectedSeries: null as string | null,
    seriesDetailsExpanded: false,
    editing: null as import("../types").StoredBook | null,
    busy: false,
    lookupGeneration: 0,
    lookupMatched: false,
    lookupDetailsExpanded: false,
    listedPrice: null as string | null,
    scanGeneration: 0,
    scanPurpose: "add",
    cameraStart: null as Promise<MediaStream> | null,
    cameraStream: null as MediaStream | null,
    cameraTimer: null as ReturnType<typeof setTimeout> | null,
    cameraRunning: false,
    photoTask: null as PhotoTask | null,
    pendingSave: null,
    pendingRemove: null,
    restoreRequests: new Map(),
    checkGeneration: 0,
    checkResult: null,
    isbnBook: null as import("../types").StoredBook | null,
    pendingIsbn: null,
    releaseFeeds: new Map(),
    releasesLoading: false,
    releasesLoaded: false,
    savingReleases: new Set(),
    seriesCatalogs: new Map(),
    catalogLoading: new Set(),
    catalogEditors: new Map(),
    catalogRefreshing: false,
    discoveryFeeds: new Map(),
    discoveryUrl: "https://www.phoenixnext.com/gl.html",
    discoveryLoading: false,
    selectedCoverId: "",
    discoveryTitleResults: new Map(),
    discoveryVolumeResults: new Map<
      string,
      {
        items: import("../types").Release[];
        loading?: boolean;
        error?: string;
        complete?: boolean;
      }
    >(),
    titleQueue: [],
    titleRequests: 0,
    discoveryRefresh: false,
    titleGeneration: 0,
    coverPickerGeneration: 0,
    editingTitle: null,
    pendingTitle: null,
    formSeries: null,
    sharedDraft: {} as Record<string, string>,
    newEdition: false,
    detailsExpanded: false,
    titleLocked: false,
    typeTouched: false,
    publisherTouched: false,
    calculatedPrice: null as string | null,
  };
}

export type CollectionState = ReturnType<typeof createCollectionState>;
