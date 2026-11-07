import test from "node:test";
import assert from "node:assert/strict";
import {
  createActivityStore,
  requestActivityLabel,
} from "../../lib/client/activity.ts";
import { translator } from "../../lib/i18n.ts";

test("activity stays visible until every concurrent task has finished", () => {
  const store = createActivityStore();
  const seen = [];
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()));
  const finishLibrary = store.begin("Loading your library…");
  const finishSearch = store.begin("Searching…");
  finishLibrary();
  assert.equal(store.getSnapshot(), "Searching…");
  finishSearch();
  assert.equal(store.getSnapshot(), "");
  finishLibrary();
  finishSearch();
  assert.deepEqual(seen, ["Loading your library…", "Searching…", ""]);
  unsubscribe();
  store.begin("No listener");
  assert.equal(seen.length, 3);
});

test("finishing the latest task reveals older work still in progress", () => {
  const store = createActivityStore();
  const finishImport = store.begin("Importing your collection…");
  const finishSearch = store.begin("Searching…");
  finishSearch();
  assert.equal(store.getSnapshot(), "Importing your collection…");
  finishImport();
  assert.equal(store.getSnapshot(), "");
});

test("aborted and already-aborted tasks cannot leave a stuck activity indicator", () => {
  const store = createActivityStore();
  const controller = new AbortController();
  const finish = store.begin("Searching…", controller.signal);
  controller.abort();
  assert.equal(store.getSnapshot(), "");
  finish();
  store.begin("Never started", controller.signal)();
  assert.equal(store.getSnapshot(), "");
});

test("ending one of two identically labelled requests does not hide activity", () => {
  const store = createActivityStore();
  const first = store.begin("Loading your library…");
  const second = store.begin("Loading your library…");
  second();
  assert.equal(store.getSnapshot(), "Loading your library…");
  first();
  assert.equal(store.getSnapshot(), "");
});

test("request activity labels describe the operation and are translated", () => {
  for (const [name, label] of [
    ["getCollection", "Loading your library…"],
    ["getBookCover", "Loading book covers…"],
    ["getPublisherDirectory", "Checking publishers and bookshops…"],
    ["getSeriesCatalog", "Checking publishers and bookshops…"],
    ["lookupIsbn", "Searching…"],
    ["checkOwnership", "Searching…"],
    ["searchPublisherIsbn", "Searching…"],
    ["saveBook", "Saving changes…"],
    ["removeBook", "Saving changes…"],
    ["restoreBook", "Saving changes…"],
  ]) {
    assert.equal(requestActivityLabel(name), label);
    assert.notEqual(translator("th")(label), label);
  }
});
