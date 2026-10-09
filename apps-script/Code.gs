/** Book Collection — bound to the existing spreadsheet; deploy with access Only myself. */
const BOOK_APP = Object.freeze({
  spreadsheetId: '1xtA2hqEGZPyvQS0ZC2NI30lJLJAugvFHPh9jQOyGhgg',
  sheetName: 'Sheet1', tableName: 'Table1',
  trashName: '_BookAppTrash', operationsName: '_BookAppOperations', releasesName: '_BookAppReleases', seriesCatalogsName: '_BookAppSeriesCatalogs',
  headers: ['ISBN', 'Series', 'Type', 'Publisher', 'Status', 'Volume', 'Source', 'Price', 'Date', 'Note'],
  fields: ['isbn', 'series', 'type', 'publisher', 'status', 'volume', 'source', 'price', 'date', 'note'],
  statuses: ['Sealed', 'Un Sealed', 'Reading', 'Read'],
  types: ['LN (EN)', 'Manga (JP) (Color)', 'Manga (TH)', 'LN (TH)', 'Manga (JP)', 'Manga (TH) (Color)', 'Other']
});
const TRASH_HEADERS = ['Trash ID', 'Removed At', 'State', 'Original Row', 'Book JSON'];
const RELEASE_HEADERS = ['Release ID', 'State', 'Book JSON', 'Updated At'];
const SERIES_CATALOG_HEADERS = ['Series', 'Publisher ID', 'Type', 'Catalog URL', 'Catalog Title'];
const PUBLISHERS = Object.freeze([
  { id: 'phoenix', name: 'Phoenix Next', url: 'https://www.phoenixnext.com/new-release.html', scope: 'Latest 72 catalog listings' },
  { id: 'firstpage', name: 'First Page Pro', url: 'https://www.firstpagepro.com/showroom/new', scope: 'Latest 40 catalog listings' },
  { id: 'luckpim', name: 'Luckpim', url: 'https://www.luckpim.com/product/list/new', scope: 'Monthly new releases, up to 200 listings' }
]);
const OP_HEADERS = ['Request ID', 'Kind', 'Request Hash', 'Result JSON', 'Created At'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('Book Collection')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Book Collection')
    .addItem('Open collection', 'openBookApp').addItem('Set up app', 'setupBookApp').addToUi();
}

function openBookApp() {
  SpreadsheetApp.getUi().showModelessDialog(
    doGet().setWidth(1120).setHeight(780), 'Book Collection');
}

/** Run once from the editor. Creates three helper tabs; never rewrites collection data. */
function setupBookApp() {
  return withLock_(function () {
    const context = context_();
    tableState_(context); // Also checks that the Sheets advanced service is enabled.
    [[BOOK_APP.trashName, TRASH_HEADERS], [BOOK_APP.operationsName, OP_HEADERS], [BOOK_APP.releasesName, RELEASE_HEADERS]].forEach(function (spec) {
      let sheet = context.ss.getSheetByName(spec[0]);
      if (!sheet) {
        sheet = context.ss.insertSheet(spec[0]);
        sheet.getRange(1, 1, 1, spec[1].length).setValues([spec[1]]);
        sheet.setFrozenRows(1);
      }
      assertHeaders_(sheet, spec[1]);
      sheet.hideSheet();
    });
    return 'Ready. Deploy as a web app with access Only myself.';
  });
}

function getCollection() {
  const c = context_();
  const rows = readRows_(c.sheet);
  const books = rows.filter(function (r) { return occupied_(r); }).map(function (r) { return book_(r, c.timeZone); });
  const options = { series: [], type: BOOK_APP.types.slice(), publisher: [], status: BOOK_APP.statuses.slice(), source: [] };
  books.forEach(function (b) {
    Object.keys(options).forEach(function (key) { if (b[key]) options[key].push(String(b[key])); });
  });
  // Include unused options already present in the sheet's dropdowns.
  const validation = c.sheet.getRange(2, 1, 1, 10).getDataValidations()[0];
  [2, 3, 4, 6].forEach(function (i) {
    const rule = validation[i];
    if (rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      options[BOOK_APP.fields[i]] = options[BOOK_APP.fields[i]].concat(rule.getCriteriaValues()[0]);
    }
  });
  Object.keys(options).forEach(function (key) { options[key] = Array.from(new Set(options[key])).sort(); });
  const trashSheet = helper_(c, BOOK_APP.trashName, TRASH_HEADERS);
  const trash = trashSheet.getLastRow() < 2 ? [] : trashSheet.getRange(2, 1, trashSheet.getLastRow() - 1, 5)
    .getValues().filter(function (r) { return r[2] === 'removed'; }).map(function (r) {
      return { id: r[0], removedAt: String(r[1]), book: JSON.parse(r[4]) };
    }).reverse();
  return {
    books: books, trash: trash, options: options,
    today: Utilities.formatDate(new Date(), c.timeZone, 'yyyy-MM-dd'),
    sheetUrl: c.ss.getUrl(), timeZone: c.timeZone, publishers: PUBLISHERS, savedReleases: savedReleases_(c)
  };
}

/** Read the current shelf for a store check. No writes or external book lookups. */
function checkOwnership(raw) {
  const isbn = normalizeIsbn_(raw);
  if (!isbn) throw new Error('Enter or scan an ISBN first.');
  const canonical = canonicalIsbn_(isbn);
  const c = context_();
  const books = readRows_(c.sheet).filter(occupied_).map(function (r) { return book_(r, c.timeZone); });
  return {
    isbn: isbn, matches: books.filter(function (b) { return canonicalIsbn_(b.isbn) === canonical; }),
    books: books, unindexedCount: books.filter(function (b) { return !canonicalIsbn_(b.isbn); }).length,
    totalCount: books.length, checkedAt: new Date().toISOString()
  };
}

/** Attach an ISBN to an existing volume, preserving every other cell and formula. */
function setBookIsbn(request) {
  return mutation_('isbn', request, function (c, rows) {
    const current = currentRow_(rows, request.row, request.token, true);
    if (current.formulas[0]) throw new Error('This ISBN cell contains a formula. Edit it directly in the sheet.');
    const isbn = normalizeIsbn_(request.isbn);
    if (!isbn) throw new Error('Enter or scan an ISBN first.');
    if (!request.allowDuplicate && rows.some(function (r) {
      return r.row !== current.row && occupied_(r) && canonicalIsbn_(r.values[0]) === canonicalIsbn_(isbn);
    })) throw new Error('This ISBN belongs to another book on your shelf. Check the selected volume, or select Another copy if you own two copies.');
    const id = c.sheet.getSheetId();
    return { requests: [
      { updateCells: { start: { sheetId: id, rowIndex: current.row - 1, columnIndex: 0 }, rows: [{ values: [cell_(isbn)] }], fields: 'userEnteredValue' } },
      { repeatCell: { range: grid_(id, current.row, 0, 1), cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } }
    ], result: { row: current.row, isbn: isbn, action: 'isbn saved' } };
  });
}

/** Save an add or edit. The request ID makes retrying a lost response safe. */
function saveBook(request) {
  return mutation_('save', request, function (c, rows) {
    const input = request.book || {};
    const normalized = normalizeBook_(input);
    let target;
    if (request.row !== undefined && request.row !== null) {
      const current = currentRow_(rows, request.row, request.token);
      target = current.row;
    } else {
      target = freeRow_(rows);
    }
    if (normalized[0] && !request.allowDuplicate) {
      const match = rows.find(function (r) {
        return r.row !== target && occupied_(r) && canonicalIsbn_(r.values[0]) === canonicalIsbn_(normalized[0]);
      });
      if (match) throw new Error('That ISBN is already in your collection (row ' + match.row + '). Check Another copy to save a second copy.');
    }
    const requests = writePlan_(c, target, normalized);
    return { requests: requests, result: { row: target, action: request.row ? 'updated' : 'added' } };
  });
}

function removeBook(request) {
  return mutation_('remove', request, function (c, rows) {
    const current = currentRow_(rows, request.row, request.token);
    const trash = helper_(c, BOOK_APP.trashName, TRASH_HEADERS);
    const id = Utilities.getUuid();
    const snapshot = book_(current, c.timeZone);
    const requests = [
      append_(trash.getSheetId(), [id, new Date().toISOString(), 'removed', current.row, JSON.stringify(snapshot)]),
      { repeatCell: { range: grid_(c.sheet.getSheetId(), current.row, 0, 10), cell: {}, fields: 'userEnteredValue' } }
    ];
    // Clear only A:J. Deleting the physical row would also move the summaries in M:N.
    return { requests: requests, result: { row: current.row, trashId: id, action: 'removed' } };
  });
}

function restoreBook(request) {
  return mutation_('restore', request, function (c, rows) {
    const trash = helper_(c, BOOK_APP.trashName, TRASH_HEADERS);
    const archived = trash.getLastRow() < 2 ? [] : trash.getRange(2, 1, trash.getLastRow() - 1, 5).getValues();
    const index = archived.findIndex(function (r) { return r[0] === request.trashId; });
    if (index < 0 || archived[index][2] !== 'removed') throw new Error('This book has already been restored. Refresh your collection.');
    const snapshot = JSON.parse(archived[index][4]);
    const target = freeRow_(rows);
    // Restore the exact values (including old/blank ISBNs) rather than re-validating legacy entries.
    const values = BOOK_APP.fields.map(function (key) { return snapshot[key] === undefined ? '' : snapshot[key]; });
    values[8] = values[8] ? dateSerial_(values[8]) : '';
    const requests = writePlan_(c, target, values);
    requests.push({ updateCells: {
      start: { sheetId: trash.getSheetId(), rowIndex: index + 1, columnIndex: 2 },
      rows: [{ values: [cell_('restored')] }], fields: 'userEnteredValue'
    } });
    return { requests: requests, result: { row: target, trashId: request.trashId, action: 'restored' } };
  });
}

/** External services receive only the ISBN. Book photos are decoded in the browser. */
function lookupIsbn(raw) {
  const isbn = normalizeIsbn_(raw);
  if (!isbn) throw new Error('Enter or scan an ISBN first.');
  const canonical = canonicalIsbn_(isbn);
  const cache = CacheService.getScriptCache();
  const cached = cache.get('isbn:v2:' + canonical);
  if (cached) return JSON.parse(cached);
  const warnings = [];
  let details = null;
  try { details = lookupNaiin_(canonical); }
  catch (e) { warnings.push('Naiin is unavailable right now. You can still search it using the link below.'); }
  if (!details) try {
    const data = fetchJson_('https://www.googleapis.com/books/v1/volumes?q=isbn:' + encodeURIComponent(canonical) + '&maxResults=5');
    const found = (data.items || []).find(function (item) {
      return ((item.volumeInfo || {}).industryIdentifiers || []).some(function (id) {
        return canonicalIsbn_(id.identifier) === canonical;
      });
    });
    if (found) {
      const v = found.volumeInfo;
      details = { title: v.title || '', publisher: v.publisher || '', authors: (v.authors || []).join(', '), source: 'Google Books' };
    }
  } catch (e) { warnings.push('Google Books is unavailable right now.'); }
  if (!details) {
    try {
      const key = 'ISBN:' + canonical;
      const data = fetchJson_('https://openlibrary.org/api/books?bibkeys=' + encodeURIComponent(key) + '&jscmd=data&format=json');
      const v = data[key];
      if (v) details = {
        title: v.title || '', publisher: (v.publishers || []).map(function (p) { return p.name; }).join(', '),
        authors: (v.authors || []).map(function (a) { return a.name; }).join(', '), source: 'Open Library'
      };
    } catch (e) { warnings.push('Open Library is unavailable right now.'); }
  }
  const result = { isbn: isbn, found: !!details, details: details, warnings: warnings, searchUrl: 'https://www.naiin.com/search-result?title=' + encodeURIComponent(canonical) };
  if (details) cache.put('isbn:v2:' + canonical, JSON.stringify(result), 21600);
  return result;
}

/** Read-only catalog requests. A failed refresh keeps the last successful cached feed. */
function getPublisherReleases(request) {
  request = request || {};
  const publisher = PUBLISHERS.find(function (p) { return p.id === request.publisherId; });
  if (!publisher) throw new Error('Choose a supported publisher.');
  const cache = CacheService.getScriptCache(), key = 'releases:v1:' + publisher.id;
  const cached = cache.get(key), previous = cached ? JSON.parse(cached) : null;
  if (previous && !request.refresh && Date.now() - Date.parse(previous.checkedAt) < 3600000) return previous;
  try {
    const items = publisher.id === 'luckpim' ? fetchLuckpim_() : fetchCatalog_(publisher);
    if (!items.length) throw new Error('No book listings could be read.');
    const result = { publisherId: publisher.id, items: items, checkedAt: new Date().toISOString(), stale: false, error: '' };
    const json = JSON.stringify(result);
    // Script Cache limits each value to 100 KB. Cache is optional, never a source of saved-list data.
    if (json.length * 3 < 95000) cache.put(key, json, 21600);
    return result;
  } catch (e) {
    if (previous) return Object.assign({}, previous, { stale: true, error: 'Could not refresh ' + publisher.name + '. Showing the previous check.' });
    return { publisherId: publisher.id, items: [], checkedAt: '', stale: true, error: 'Could not read ' + publisher.name + ' right now. Open the publisher website or try Refresh releases.' };
  }
}

/** A series comparison reads its category, independently of the recent-release feed. */
function getSeriesCatalog(request) {
  const spec = seriesCatalogRequest_(request), cache = CacheService.getScriptCache();
  const saved = savedSeriesCatalog_(spec), key = 'series:v1:' + spec.publisherId + ':' + digest_(spec.series + '\n' + spec.type + '\n' + (saved ? saved.url : ''));
  const previous = cachedJson_(cache, key);
  if (previous && !spec.refresh && Date.now() - Date.parse(previous.checkedAt) < 3600000) return previous;
  let category = saved;
  try {
    if (!category && spec.publisherId !== 'luckpim') {
      const directory = getSeriesCategories({ publisherId: spec.publisherId });
      category = matchSeriesCategory_(spec.series, directory.categories, spec.type);
      if (!category) return { publisherId: spec.publisherId, series: spec.series, type: spec.type, items: [], checkedAt: '', complete: false, stale: false,
        needsSelection: true, categories: directory.categories, directoryUrl: directory.url, error: directory.error || '' };
    }
    if (!category) category = { title: spec.series, url: 'https://www.luckpim.com/search_result?k=' + encodeURIComponent(spec.series) };
    const catalog = spec.publisherId === 'luckpim' ? fetchLuckpimSeries_(category.url) : fetchSeriesCategory_(spec.publisherId, category.url);
    if (catalog.title) category = { title: catalog.title, url: category.url };
    catalog.items.forEach(function (item) {
      item.catalogSeries = spec.series;
      item.catalogVariant = catalogSeriesKey_(item.series) !== catalogSeriesKey_(category.title) && catalogSeriesKey_(item.series) !== catalogSeriesKey_(spec.series);
    });
    const result = Object.assign(catalog, { publisherId: spec.publisherId, series: spec.series, type: spec.type, title: category.title, url: category.url,
      checkedAt: new Date().toISOString(), stale: false, needsSelection: !!catalog.search && !catalog.items.length,
      error: catalog.search && !catalog.items.length ? 'No books matched this search. Check the publisher’s series title.' : catalog.complete ? '' : 'This category check is incomplete. Open the publisher category to check the remaining books.' });
    cacheJson_(cache, key, result);
    return result;
  } catch (error) {
    if (previous) return Object.assign({}, previous, { stale: true, error: 'Could not refresh this series catalog. Showing the previous check.' });
    return { publisherId: spec.publisherId, series: spec.series, type: spec.type, items: [], title: category ? category.title : '', url: category ? category.url : '',
      checkedAt: '', complete: false, stale: true, needsSelection: false, error: 'Could not check this series catalog. Try Refresh catalog or choose its category.' };
  }
}

function seriesCatalogRequest_(request) {
  request = request || {};
  const series = String(request.series || '').trim(), publisher = PUBLISHERS.find(function (p) { return p.id === request.publisherId; });
  if (!series || series.length > 500 || !publisher) throw new Error('Choose a series and a supported publisher.');
  const type = String(request.type || '').trim();
  if (type.length > 100) throw new Error('Choose a valid book type.');
  return { series: series, publisherId: publisher.id, type: type, refresh: request.refresh === true };
}

function cachedJson_(cache, key) { try { const json = cache.get(key); return json ? JSON.parse(json) : null; } catch (error) { return null; } }
function cacheJson_(cache, key, value) {
  const json = JSON.stringify(value);
  if (json.length * 3 < 95000) cache.put(key, json, 21600);
}

function safeSeriesCatalogUrl_(raw, id) {
  const url = decodeHtml_(String(raw || '').trim());
  if (id === 'phoenix' && /^https:\/\/www\.phoenixnext\.com\/book-series\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.html$/.test(url)) return url;
  const first = id === 'firstpage' && /^https:\/\/www\.firstpagepro\.com\/category\/(\d+)(?:\/[^?#]*)?\/?$/.exec(url);
  if (first) return 'https://www.firstpagepro.com/category/' + first[1];
  if (id === 'luckpim' && /^https:\/\/www\.luckpim\.com\/search_result\?k=[^&#]+$/.test(url)) {
    try { const keyword = decodeURIComponent(url.split('?k=')[1]).trim(); return keyword && keyword.length <= 500 ? 'https://www.luckpim.com/search_result?k=' + encodeURIComponent(keyword) : ''; } catch (error) {}
  }
  return '';
}

function savedSeriesCatalog_(spec) {
  const sheet = context_().ss.getSheetByName(BOOK_APP.seriesCatalogsName);
  if (!sheet) return null;
  assertHeaders_(sheet, SERIES_CATALOG_HEADERS);
  const rows = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  const row = rows.find(function (r) { return catalogSeriesKey_(r[0]) === catalogSeriesKey_(spec.series) && r[1] === spec.publisherId && r[2] === spec.type; });
  const url = row && safeSeriesCatalogUrl_(row[3], spec.publisherId);
  return url ? { url: url, title: String(row[4] || spec.series) } : null;
}

/** Save an explicitly selected category; do not change the collection's book columns. */
function setSeriesCatalog(request) {
  const spec = seriesCatalogRequest_(request), url = safeSeriesCatalogUrl_(request.url, spec.publisherId);
  if (!url) throw new Error('Use this publisher’s series category URL.');
  return withLock_(function () {
    const c = context_();
    let sheet = c.ss.getSheetByName(BOOK_APP.seriesCatalogsName);
    if (!sheet) { sheet = c.ss.insertSheet(BOOK_APP.seriesCatalogsName); sheet.getRange(1, 1, 1, 5).setValues([SERIES_CATALOG_HEADERS]); sheet.setFrozenRows(1); sheet.hideSheet(); }
    assertHeaders_(sheet, SERIES_CATALOG_HEADERS);
    const rows = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
    const index = rows.findIndex(function (r) { return catalogSeriesKey_(r[0]) === catalogSeriesKey_(spec.series) && r[1] === spec.publisherId && r[2] === spec.type; });
    // Explicit string values protect titles beginning with a formula character.
    const row = index < 0 ? sheet.getLastRow() + 1 : index + 2, title = String(request.title || spec.series).slice(0, 500);
    Sheets.Spreadsheets.batchUpdate({ requests: [{ updateCells: { start: { sheetId: sheet.getSheetId(), rowIndex: row - 1, columnIndex: 0 },
      rows: [{ values: [spec.series, spec.publisherId, spec.type, url, title].map(function (value) { return { userEnteredValue: { stringValue: value } }; }) }], fields: 'userEnteredValue' } }] }, BOOK_APP.spreadsheetId);
    return { series: spec.series, publisherId: spec.publisherId, type: spec.type, url: url, title: title };
  });
}

function getSeriesCategories(request) {
  const id = request && request.publisherId;
  if (!PUBLISHERS.some(function (p) { return p.id === id; }) || id === 'luckpim') throw new Error('Choose Phoenix Next or First Page Pro for series categories.');
  const cache = CacheService.getScriptCache(), key = 'series-directory:v1:' + id, previous = cachedJson_(cache, key);
  if (previous && !request.refresh && Date.now() - Date.parse(previous.checkedAt) < 3600000) return previous;
  const url = id === 'phoenix' ? 'https://www.phoenixnext.com/book-series.html' : 'https://www.firstpagepro.com/';
  try {
    const categories = parseSeriesCategories_(id, fetchText_(url));
    if (!categories.length) throw new Error('Category directory unavailable');
    const result = { publisherId: id, url: url, categories: categories, checkedAt: new Date().toISOString(), stale: false, error: '' };
    cacheJson_(cache, key, result);return result;
  } catch (error) {
    if (previous) return Object.assign({}, previous, { stale: true, error: 'Category directory could not refresh. Showing previously found categories.' });
    throw new Error('Could not load this publisher’s series categories. Paste its series category URL or try again.');
  }
}

function catalogSeriesKey_(text) {
  return String(text || '').normalize('NFKC').toLocaleLowerCase().replace(/^(?:\(LN\)|\(มังงะ\)|\(นิยาย\)|นิยาย|การ์ตูน)\s*/i, '').replace(/@comic/gi, '').replace(/(?:\s*\(\d+\)\s*รายการ|\s*\[\d+\])\s*$/, '').replace(/[^\p{L}\p{N}\p{M}]/gu, '');
}
function parseSeriesCategories_(id, html) {
  const categories = new Map(), anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  anchors.forEach(function (anchor) {
    const url = safeSeriesCatalogUrl_(attr_(anchor.slice(0, anchor.indexOf('>') + 1), 'href'), id);
    const title = textHtml_(anchor.slice(anchor.indexOf('>') + 1, anchor.lastIndexOf('</a>'))).replace(/(?:\s*\(\d+\)\s*รายการ|\s*\[\d+\])\s*$/, '').trim();
    const rawUrl = attr_(anchor.slice(0, anchor.indexOf('>') + 1), 'href');
    const type = id === 'firstpage' ? /\/light-novel/i.test(rawUrl) ? 'LN (TH)' : /\/manga/i.test(rawUrl) ? 'Manga (TH)' : '' : '';
    if (url && title && !categories.has(url)) categories.set(url, { title: title, url: url, type: type });
  });
  return Array.from(categories.values()).sort(function (a, b) { return a.title.localeCompare(b.title); });
}
function matchSeriesCategory_(series, categories, type) {
  categories = categories.filter(function (category) { return !type || !category.type || category.type.split(' (')[0] === type.split(' (')[0]; });
  const key = catalogSeriesKey_(series);
  const exact = categories.filter(function (c) { return catalogSeriesKey_(c.title) === key; });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // Several formats can share the same title.
  const slug = categories.filter(function (c) { return catalogSeriesKey_(c.url.split('/').pop().replace(/\.html$/, '')) === key; });
  return slug.length === 1 ? slug[0] : null;
}

function catalogTotal_(id, html) {
  const pattern = id === 'phoenix' ? /<span\b[^>]*class=["'][^"']*\btoolbar-number\b[^"']*["'][^>]*>\s*([\d,]+)\s*<\/span>/i : /<span\b[^>]*class=["'][^"']*\btsk-all\b[^"']*["'][^>]*>\s*([\d,]+)\s*<\/span>/i;
  const match = pattern.exec(html);return match ? Number(match[1].replace(/,/g, '')) : null;
}
function fetchSeriesCategory_(id, url) {
  const items = new Map();let total = null, complete = false, pages = 0, title = '';
  for (let page = 1; page <= 20; page++) {
    const html = fetchText_(url + (page > 1 ? (id === 'phoenix' ? '?p=' : '?tskp=') + page : ''));
    if (page === 1) { total = catalogTotal_(id, html); const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || /<title\b[^>]*>([^<]*)<\/title>/i.exec(html);title = heading ? textHtml_(heading[1]) : ''; }
    const parsed = parseCatalog_(id, html), before = items.size;
    parsed.forEach(function (item) { items.set(item.id, item); });pages++;
    if (total !== null && items.size === total) { complete = true;break; }
    if (!parsed.length) { if (page === 1 && total !== 0) throw new Error('Category markup changed'); break; }
    if (items.size === before) break; // A repeated page must not masquerade as a complete catalog.
    const next = (html.match(/<a\b[^>]*>/gi) || []).some(function (anchor) {
      const href = attr_(anchor, 'href'), param = id === 'phoenix' ? 'p' : 'tskp';
      return href.indexOf(url) === 0 && new RegExp('[?&]' + param + '=' + (page + 1) + '(?:&|$)').test(href);
    });
    if (!next && (total === null || items.size >= total)) break;
  }
  return { items: Array.from(items.values()), total: total, pages: pages, complete: complete, title: title };
}

function fetchLuckpimSeries_(url) {
  const keyword = decodeURIComponent(url.split('?k=')[1]), session = luckpimSession_('https://www.luckpim.com/');
  const result = UrlFetchApp.fetch('https://www.luckpim.com/get/search_pin/key?page=1&limit=-1&keyword=' + encodeURIComponent(keyword), { muteHttpExceptions: true, headers: session });
  if (result.getResponseCode() !== 200) throw new Error('Series search unavailable');
  const response = JSON.parse(result.getContentText()), data = response.data;
  if (response.status !== 200 || !data || !Array.isArray(data.list) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('Series search changed');
  const items = data.list.map(luckpimItem_).filter(Boolean);
  return { items: items, total: data.total, pages: 1, complete: items.length === data.total, search: true };
}

function luckpimSession_(url) {
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (response.getResponseCode() !== 200) throw new Error('Catalog unavailable');
  const tag = /<input\b[^>]*name=["']?__RequestVerificationToken["']?[^>]*>/i.exec(response.getContentText()), token = tag && attr_(tag[0], 'value');
  if (!token) throw new Error('Catalog token unavailable');
  const headers = response.getAllHeaders(), cookieHeader = headers['Set-Cookie'] || headers['set-cookie'] || [];
  return { 'XSRF-TOKEN': token, Cookie: (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader]).map(function (v) { return String(v).split(';')[0]; }).join('; ') };
}
function luckpimItem_(book) {
  if (!/^\d+$/.test(String(book.slug))) return null;
  const type = /นิยาย|novel/i.test(book.main_category || '') ? 'LN (TH)' : /มังงะ|การ์ตูน/i.test(book.main_category || '') ? 'Manga (TH)' : '';
  const item = releaseItem_('luckpim', book.title, 'https://www.luckpim.com/product/detail/' + book.slug, book.price_sale == null ? book.price : book.price_sale, '', type);
  item.availability = book.pre_order === 'T' ? 'Pre-order' : Number(book.stock) > 0 ? 'In stock' : 'Check availability';return item;
}

function savedReleases_(c) {
  const sheet = c.ss.getSheetByName(BOOK_APP.releasesName);
  if (!sheet) return []; // Existing installations upgrade without another setup run.
  assertHeaders_(sheet, RELEASE_HEADERS);
  return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return r[1] === 'saved'; }).map(function (r) { return JSON.parse(r[2]); });
}

/** Absolute saved/unsaved state makes retries safe without adding a book to the shelf. */
function setSavedRelease(request) {
  if (!request || typeof request.saved !== 'boolean') throw new Error('Choose Save for later or Unsave.');
  const item = cleanRelease_(request.release);
  return withLock_(function () {
    const c = context_();
    let sheet = c.ss.getSheetByName(BOOK_APP.releasesName);
    if (!sheet) {
      sheet = c.ss.insertSheet(BOOK_APP.releasesName);
      sheet.getRange(1, 1, 1, 4).setValues([RELEASE_HEADERS]);sheet.setFrozenRows(1);sheet.hideSheet();
    }
    assertHeaders_(sheet, RELEASE_HEADERS);
    const rows = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    const index = rows.findIndex(function (r) { return r[0] === item.id; });
    sheet.getRange(index < 0 ? sheet.getLastRow() + 1 : index + 2, 1, 1, 4)
      .setValues([[item.id, request.saved ? 'saved' : 'unsaved', JSON.stringify(item), new Date().toISOString()]]);
    return { savedReleases: savedReleases_(c) };
  });
}

function cleanRelease_(input) {
  input = input || {};
  const p = PUBLISHERS.find(function (p) { return p.id === input.publisherId; });
  const url = safeProductUrl_(input.url, p && p.id);
  if (!p || !url || !String(input.title || '').trim()) throw new Error('This release is missing its publisher or book page. Refresh releases.');
  const item = releaseItem_(p.id, String(input.title).slice(0, 500), url, input.price, input.isbn, input.type);
  item.series = String(input.series || item.series).slice(0, 500);
  item.volume = input.volume === '' || input.volume === undefined ? item.volume : Number(input.volume);
  if (item.volume !== '' && (!Number.isFinite(item.volume) || item.volume < 0)) throw new Error('Invalid release volume.');
  item.availability = String(input.availability || '').slice(0, 100);
  if (input.catalogSeries) item.catalogSeries = String(input.catalogSeries).slice(0, 500);
  if (input.catalogVariant) item.catalogVariant = true;
  return item;
}

function safeProductUrl_(raw, id) {
  const url = decodeHtml_(String(raw || ''));
  const patterns = {
    phoenix: /^https:\/\/www\.phoenixnext\.com\/[a-zA-Z0-9_-]+\.html$/,
    firstpage: /^https:\/\/www\.firstpagepro\.com\/product\/(\d+)(?:\/[^?#]*)?$/,
    luckpim: /^https:\/\/www\.luckpim\.com\/product\/detail\/\d+\/?$/
  };
  if (!patterns[id] || !patterns[id].test(url)) return '';
  if (id === 'firstpage') return 'https://www.firstpagepro.com/product/' + url.match(patterns[id])[1];
  return url.replace(/\/$/, '');
}

function releaseItem_(id, title, url, price, isbn, type) {
  const parsed = splitBookTitle_(title);
  const special = /special\s*set|complete\s*set|box\s*set|limited|เซต|ชุด|ปกพิเศษ/i.test(title);
  const p = PUBLISHERS.find(function (p) { return p.id === id; });
  return {
    id: id + ':' + digest_(url), publisherId: id, publisher: p.name, title: decodeHtml_(title),
    series: parsed.series, volume: parsed.volume, type: type || parsed.type, url: url,
    isbn: special ? '' : canonicalIsbn_(isbn) || '', price: price !== '' && price !== null && price !== undefined && Number.isFinite(Number(price)) && Number(price) >= 0 ? Number(price) : '',
    special: special, availability: ''
  };
}

function splitBookTitle_(raw) {
  let title = decodeHtml_(String(raw || '')).replace(/\s+/g, ' ').trim();
  const type = /\(LN\)|\(นิยาย\)|^นิยาย|light\s*novel|ไลท์โนเวล/i.test(title) ? 'LN (TH)' : /มังงะ|การ์ตูน|@COMIC|\(Mg\)/i.test(title) ? 'Manga (TH)' : '';
  title = title.replace(/^\[PRE-ORDER\]\s*/i, '').replace(/^(?:\(LN\)|\(มังงะ\)|\(นิยาย\)|นิยาย|การ์ตูน)\s*/i, '');
  const explicit = /(?:เล่ม(?:ที่)?|vol(?:ume)?\.?)\s*(\d+(?:\.\d+)?)/i.exec(title);
  // Luckpim also uses bare volume numbers before ending/format labels or promotions.
  const suffix = /\s+(\d+(?:\.\d+)?)(?=\s*(?:$|(?:\([^)]*\)\s*)+$|\[|แถม|ฟรี|พร้อม))/i.exec(title);
  const match = explicit || suffix;
  let series = match ? title.slice(0, match.index).trim() : title.replace(/\s*\((?:Mg|LN)\)\s*$/i, '').trim();
  series = series.replace(/\s*[-–:]\s*$/, '').trim();
  return { series: series, volume: match ? Number(match[1]) : '', type: type };
}

function fetchCatalog_(p) {
  let items = [];
  for (let page = 1; page <= 2; page++) {
    const url = p.url + (page > 1 ? '?tskp=' + page : '');
    // Phoenix uses p, First Page Pro uses tskp.
    const html = fetchText_(p.id === 'phoenix' && page > 1 ? p.url + '?p=' + page : url);
    const parsed = parseCatalog_(p.id, html);
    if (!parsed.length) { if (page === 1) throw new Error('Catalog unavailable'); break; }
    items = items.concat(parsed);
  }
  const seen = {};
  return items.filter(function (item) { if (seen[item.id]) return false; seen[item.id] = true; return true; }).slice(0, p.id === 'phoenix' ? 72 : 40);
}

/** Parse only product cards, excluding navigation and recommendations. No remote HTML reaches the UI. */
function parseCatalog_(id, html) {
  const items = [];
  const cards = id === 'firstpage' ? html.split(/<div\b[^>]*class=["'][^"']*\bproductArea\b[^"']*\bproductItem\b[^"']*["'][^>]*>/i).slice(1)
    : html.split(/<a\b(?=[^>]*\bclass=["'][^"']*\bproduct-item-link\b)[^>]*>/i).slice(1);
  const anchors = id === 'phoenix' ? html.match(/<a\b(?=[^>]*\bclass=["'][^"']*\bproduct-item-link\b)[^>]*>/gi) || [] : [];
  cards.forEach(function (card, index) {
    let title, url, price = '', isbn = '';
    if (id === 'firstpage') {
      const anchor = /<a\b[^>]*class=["'][^"']*gadgetThumbnail[^"']*["'][^>]*>/i.exec(card);
      if (!anchor) return;
      title = attr_(anchor[0], 'title');url = attr_(anchor[0], 'href');
      const ga = attr_(anchor[0], 'GAEEPD');
      try { price = JSON.parse(ga).price; } catch (e) {}
    } else {
      title = textHtml_(card.slice(0, card.indexOf('</a>')));
      url = attr_(anchors[index] || '', 'href');
      const amount = /data-price-amount=["']([\d.]+)["']/i.exec(card);price = amount ? amount[1] : '';
      const code = /isbnet=(\d{13})/.exec(card);isbn = code ? code[1] : '';
    }
    url = safeProductUrl_(url, id);
    if (url && title) items.push(releaseItem_(id, title, url, price, isbn));
  });
  return items;
}

function fetchLuckpim_() {
  const session = luckpimSession_('https://www.luckpim.com/product/list/new');
  let items = [];
  for (let page = 1; page <= 2; page++) {
    const result = UrlFetchApp.fetch('https://www.luckpim.com/_api/getBookList?setting=new&page=' + page + '&limit=100', {
      muteHttpExceptions: true, headers: session
    });
    if (result.getResponseCode() !== 200) throw new Error('Catalog unavailable');
    const data = JSON.parse(result.getContentText());
    if (data.sc !== 200 || !data.d || !Array.isArray(data.d.data)) throw new Error('Catalog changed');
    data.d.data.forEach(function (book) { const item = luckpimItem_(book); if (item) items.push(item); });
    if (page * 100 >= Number(data.d.total) || data.d.data.length < 100) break;
  }
  return items;
}

function lookupNaiin_(canonical) {
  const html = fetchText_('https://www.naiin.com/search-result?title=' + encodeURIComponent(canonical));
  const component = /<product-list\b[^>]*>/i.exec(html);
  if (!component) throw new Error('Search markup unavailable');
  let candidates;
  try { candidates = JSON.parse(attr_(component[0], ':items')); } catch (e) { throw new Error('Search markup changed'); }
  if (!Array.isArray(candidates)) throw new Error('Search markup changed');
  candidates = candidates.filter(function (v) { return Number(v.ProductTypeId) === 1 && /^\d+$/.test(String(v.ProductID)); }).slice(0, 4);
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i], url = 'https://www.naiin.com/product/detail/' + candidate.ProductID;
    const page = fetchText_(url), data = structuredBooks_(page);
    const exact = data.find(function (b) { return [b.isbn, b.gtin13, b.sku].some(function (code) { return canonicalIsbn_(code) === canonical; }); });
    const metaIsbn = meta_(page, 'book:isbn');
    if (!exact && canonicalIsbn_(metaIsbn) !== canonical) continue;
    const book = exact || {}, title = book.name || candidate.ProductName || '';
    if (!title) continue;
    const parsed = splitBookTitle_(title);
    return { title: title, series: parsed.series, volume: parsed.volume, type: parsed.type,
      publisher: names_(book.publisher) || candidate.PublisherName || '', authors: names_(book.author) || candidate.AuthorName || '',
      source: 'Naiin', url: url, releaseDate: meta_(page, 'book:release_date') };
  }
  return null;
}

function names_(v) { return (Array.isArray(v) ? v : v ? [v] : []).map(function (x) { return typeof x === 'string' ? x : x.name || ''; }).filter(Boolean).join(', '); }
function structuredBooks_(html) {
  const out = [], re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  function visit(v) { if (!v || typeof v !== 'object') return;if (Array.isArray(v)) return v.forEach(visit);if (v.isbn || v.gtin13 || v.sku) out.push(v);if (v['@graph']) visit(v['@graph']); }
  let match;while ((match = re.exec(html))) { try { visit(JSON.parse(match[1])); } catch (e) {} }return out;
}
function meta_(html, property) { const tags = html.match(/<meta\b[^>]*>/gi) || [];const tag = tags.find(function (t) { return attr_(t, 'property') === property; });return tag ? attr_(tag, 'content') : ''; }
function attr_(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('(?:^|\\s)' + escaped + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
  return match ? decodeHtml_(match[1] === undefined ? match[2] === undefined ? match[3] : match[2] : match[1]) : '';
}
function decodeHtml_(s) {
  return String(s).replace(/&#(x[\da-f]+|\d+);/gi, function (_, n) { const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; })
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function textHtml_(s) { return decodeHtml_(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function fetchText_(url) { const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });if (r.getResponseCode() !== 200) throw new Error('Website unavailable');return r.getContentText(); }

function context_() {
  const ss = SpreadsheetApp.openById(BOOK_APP.spreadsheetId);
  const sheet = ss.getSheetByName(BOOK_APP.sheetName);
  if (!sheet) throw new Error('Cannot find the ' + BOOK_APP.sheetName + ' tab.');
  assertHeaders_(sheet, BOOK_APP.headers);
  return { ss: ss, sheet: sheet, timeZone: ss.getSpreadsheetTimeZone() };
}

function assertHeaders_(sheet, expected) {
  const actual = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0];
  if (actual.some(function (v, i) { return v.trim() !== expected[i]; })) {
    throw new Error('The columns in ' + sheet.getName() + ' have changed. Expected: ' + expected.join(', ') + '. No books were changed.');
  }
}

function helper_(c, name, headers) {
  const sheet = c.ss.getSheetByName(name);
  if (!sheet) throw new Error('Run setupBookApp once in the Apps Script editor before using the app.');
  assertHeaders_(sheet, headers);
  return sheet;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Another change is being saved. Please try again.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function mutation_(kind, request, plan) {
  if (!request || !/^[a-zA-Z0-9_-]{12,100}$/.test(request.requestId || '')) throw new Error('Refresh the app and try again.');
  return withLock_(function () {
    const c = context_();
    const ops = helper_(c, BOOK_APP.operationsName, OP_HEADERS);
    const hash = digest_(stableJson_(request));
    const log = ops.getLastRow() < 2 ? [] : ops.getRange(2, 1, ops.getLastRow() - 1, 5).getValues();
    const previous = log.find(function (r) { return r[0] === request.requestId; });
    if (previous) {
      if (previous[1] !== kind || previous[2] !== hash) throw new Error('This request ID was already used for a different change. Refresh and try again.');
      return JSON.parse(previous[3]);
    }
    const change = plan(c, readRows_(c.sheet));
    change.requests.push(append_(ops.getSheetId(), [request.requestId, kind, hash, JSON.stringify(change.result), new Date().toISOString()]));
    // Collection changes, recoverable removal, and the retry receipt succeed or fail together.
    Sheets.Spreadsheets.batchUpdate({ requests: change.requests }, BOOK_APP.spreadsheetId);
    return change.result;
  });
}

function readRows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10);
  const values = range.getValues();
  const formulas = range.getFormulas();
  return values.map(function (v, i) { return { row: i + 2, values: v, formulas: formulas[i] }; });
}

function occupied_(r) {
  return r.values.some(function (v) { return v !== '' && v !== null; }) || r.formulas.some(Boolean);
}

function freeRow_(rows) {
  const empty = rows.find(function (r) { return !occupied_(r); });
  return empty ? empty.row : rows.length + 2;
}

function currentRow_(rows, row, token, allowOtherFormulas) {
  if (!Number.isInteger(row) || row < 2) throw new Error('Invalid book row.');
  const current = rows.find(function (r) { return r.row === row; });
  if (!current || !occupied_(current) || !token || token !== rowToken_(current)) {
    throw new Error('This book changed or moved in the sheet. Refresh and open it again before saving or removing.');
  }
  if (!allowOtherFormulas && current.formulas.some(Boolean)) throw new Error('This book row contains a formula. Edit it directly in the sheet to preserve the formula.');
  return current;
}

function rowToken_(r) { return digest_(JSON.stringify([r.row, r.values, r.formulas])); }

function book_(r, timeZone) {
  const b = { row: r.row, token: rowToken_(r), hasFormula: r.formulas.some(Boolean), isbnHasFormula: !!r.formulas[0] };
  BOOK_APP.fields.forEach(function (key, i) {
    const v = r.values[i];
    b[key] = v instanceof Date ? Utilities.formatDate(v, timeZone, 'yyyy-MM-dd') : v;
  });
  return b;
}

function tableState_(c) {
  if (typeof Sheets === 'undefined') throw new Error('Enable Google Sheets API under Services in the Apps Script editor.');
  const data = Sheets.Spreadsheets.get(BOOK_APP.spreadsheetId, { fields: 'sheets(properties(sheetId),tables,basicFilter(range,tableId))' });
  const s = (data.sheets || []).find(function (s) { return s.properties.sheetId === c.sheet.getSheetId(); });
  const table = s && (s.tables || []).find(function (t) { return t.name === BOOK_APP.tableName; });
  if (!table) throw new Error('Cannot find Table1. Check the table name in Sheet1 before saving; your spending formulas depend on it.');
  const r = table.range;
  if ((r.startRowIndex || 0) !== 0 || (r.startColumnIndex || 0) !== 0 || r.endColumnIndex !== 10) {
    throw new Error('Table1 must start at A1 and cover columns A:J. No books were changed.');
  }
  if (table.rowsProperties && table.rowsProperties.footerColorStyle) throw new Error('Table1 has a footer. Remove the footer or adapt the app before saving.');
  return { table: table, basicFilter: s.basicFilter };
}

function rangesOverlap_(a, b) {
  if ((a.sheetId || 0) !== (b.sheetId || 0)) return false;
  return ['Row', 'Column'].every(function (axis) {
    const start = 'start' + axis + 'Index';
    const end = 'end' + axis + 'Index';
    return (a[start] || 0) < (b[end] === undefined ? Infinity : b[end]) &&
      (b[start] || 0) < (a[end] === undefined ? Infinity : a[end]);
  });
}

function writePlan_(c, row, values) {
  const requests = [];
  const id = c.sheet.getSheetId();
  const state = tableState_(c);
  const table = state.table;
  if (row > c.sheet.getMaxRows()) {
    requests.push({ appendDimension: { sheetId: id, dimension: 'ROWS', length: row - c.sheet.getMaxRows() } });
  }
  const update = { tableId: table.tableId };
  const fields = [];
  if (row > table.range.endRowIndex) {
    update.range = Object.assign({}, table.range, { endRowIndex: row });
    fields.push('range');
  }
  // Expand the existing table dropdowns when a new publisher or shop is entered.
  const columns = JSON.parse(JSON.stringify(table.columnProperties || []));
  let dropdownChanged = false;
  columns.forEach(function (column) {
    const condition = column.dataValidationRule && column.dataValidationRule.condition;
    const v = values[column.columnIndex];
    if (condition && condition.type === 'ONE_OF_LIST' && v !== '') {
      condition.values = condition.values || [];
      if (!condition.values.some(function (item) { return item.userEnteredValue === String(v); })) {
        condition.values.push({ userEnteredValue: String(v) }); dropdownChanged = true;
      }
    }
  });
  if (dropdownChanged) { update.columnProperties = columns; fields.push('columnProperties'); }
  if (fields.length) {
    const filter = state.basicFilter;
    // Regular range filters block table updates. Keep table-backed filters and unrelated ranges.
    // Clearing in this batch also preserves the filter if any part of the save fails.
    if (filter && !filter.tableId && filter.range && rangesOverlap_(filter.range, update.range || table.range)) {
      requests.push({ clearBasicFilter: { sheetId: id } });
    }
    requests.push({ updateTable: { table: update, fields: fields.join(',') } });
  }
  requests.push({ updateCells: {
    start: { sheetId: id, rowIndex: row - 1, columnIndex: 0 },
    rows: [{ values: values.map(cell_) }], fields: 'userEnteredValue'
  } });
  requests.push({ repeatCell: {
    range: grid_(id, row, 0, 1), cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
    fields: 'userEnteredFormat.numberFormat'
  } });
  requests.push({ repeatCell: {
    range: grid_(id, row, 8, 9), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
    fields: 'userEnteredFormat.numberFormat'
  } });
  return requests;
}

function grid_(id, row, start, end) {
  return { sheetId: id, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: start, endColumnIndex: end };
}

function cell_(v) {
  if (v === '' || v === null || v === undefined) return {};
  // Explicit stringValue stores titles/notes beginning with '=' as text, never executable formulas.
  return { userEnteredValue: typeof v === 'number' ? { numberValue: v } : { stringValue: String(v) } };
}

function append_(id, values) {
  return { appendCells: { sheetId: id, rows: [{ values: values.map(cell_) }], fields: 'userEnteredValue' } };
}

function normalizeBook_(b) {
  const values = BOOK_APP.fields.map(function (key) {
    const value = b[key] === undefined || b[key] === null ? '' : String(b[key]).trim();
    if (value.length > (key === 'note' ? 2000 : 500)) throw new Error(key + ' is too long.');
    return value;
  });
  if (!values[1]) throw new Error('Enter a series or book title.');
  values[0] = normalizeIsbn_(values[0]);
  if (!values[2]) throw new Error('Choose a book type.');
  if (!values[4]) throw new Error('Choose a reading status.');
  [5, 7].forEach(function (i) {
    if (values[i] !== '') {
      if (!/^\d+(?:\.\d+)?$/.test(values[i]) || !Number.isFinite(Number(values[i]))) {
        throw new Error(BOOK_APP.headers[i] + ' must be a non-negative number.');
      }
      values[i] = Number(values[i]);
    }
  });
  values[8] = values[8] ? dateSerial_(values[8]) : '';
  return values;
}

function dateSerial_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid date.');
  const parts = value.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (parts[0] < 1900 || parts[0] > 9999 || date.toISOString().slice(0, 10) !== value) throw new Error('Choose a valid date.');
  return Math.round((date.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
}

function normalizeIsbn_(raw) {
  const value = String(raw === undefined || raw === null ? '' : raw).trim()
    .replace(/^ISBN(?:-1[03])?\s*:?\s*/i, '').replace(/[\s-]/g, '').toUpperCase();
  if (!value) return '';
  let sum = 0;
  if (/^\d{9}[\dX]$/.test(value)) {
    for (let i = 0; i < 10; i++) sum += (value[i] === 'X' ? 10 : Number(value[i])) * (10 - i);
    if (sum % 11 === 0) return value;
  } else if (/^97[89]\d{10}$/.test(value)) {
    for (let i = 0; i < 13; i++) sum += Number(value[i]) * (i % 2 ? 3 : 1);
    if (sum % 10 === 0) return value;
  }
  throw new Error('That ISBN is not valid. Scan the 978/979 barcode or enter a valid ISBN-10/ISBN-13.');
}

function canonicalIsbn_(raw) {
  let value;
  try { value = normalizeIsbn_(raw); } catch (e) { return ''; }
  if (value.length !== 10) return value;
  const stem = '978' + value.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(stem[i]) * (i % 2 ? 3 : 1);
  return stem + ((10 - sum % 10) % 10);
}

function stableJson_(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableJson_).join(',') + ']';
  return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stableJson_(v[k]); }).join(',') + '}';
}

function digest_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text)).replace(/=+$/, '');
}

function fetchJson_(url) {
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Book lookup service returned ' + response.getResponseCode());
  return JSON.parse(response.getContentText());
}
