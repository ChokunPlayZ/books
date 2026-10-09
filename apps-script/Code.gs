/** Book Collection — bound to the existing spreadsheet; deploy with access Only myself. */
const BOOK_APP = Object.freeze({
  spreadsheetId: '1xtA2hqEGZPyvQS0ZC2NI30lJLJAugvFHPh9jQOyGhgg',
  sheetName: 'Sheet1', tableName: 'Table1',
  trashName: '_BookAppTrash', operationsName: '_BookAppOperations', releasesName: '_BookAppReleases',
  headers: ['ISBN', 'Series', 'Type', 'Publisher', 'Status', 'Volume', 'Source', 'Price', 'Date', 'Note'],
  fields: ['isbn', 'series', 'type', 'publisher', 'status', 'volume', 'source', 'price', 'date', 'note'],
  statuses: ['Sealed', 'Un Sealed', 'Reading', 'Read'],
  types: ['LN (EN)', 'Manga (JP) (Color)', 'Manga (TH)', 'LN (TH)', 'Manga (JP)', 'Manga (TH) (Color)', 'Other']
});
const TRASH_HEADERS = ['Trash ID', 'Removed At', 'State', 'Original Row', 'Book JSON'];
const RELEASE_HEADERS = ['Release ID', 'State', 'Book JSON', 'Updated At'];
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
  // Some Luckpim books end in a bare volume, optionally followed by (จบ).
  const suffix = /\s+(\d+(?:\.\d+)?)(?:\s*\([^)]*\))*\s*$/.exec(title);
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
  // Same public token/cookie handshake as the publisher's browser catalog.
  const response = UrlFetchApp.fetch('https://www.luckpim.com/product/list/new', { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (response.getResponseCode() !== 200) throw new Error('Catalog unavailable');
  const html = response.getContentText(), tokenTag = /<input\b[^>]*name=["']?__RequestVerificationToken["']?[^>]*>/i.exec(html);
  const token = tokenTag && attr_(tokenTag[0], 'value');
  if (!token) throw new Error('Catalog token unavailable');
  const headers = response.getAllHeaders(), cookieHeader = headers['Set-Cookie'] || headers['set-cookie'] || [];
  const cookies = (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader]).map(function (v) { return String(v).split(';')[0]; }).join('; ');
  let items = [];
  for (let page = 1; page <= 2; page++) {
    const result = UrlFetchApp.fetch('https://www.luckpim.com/_api/getBookList?setting=new&page=' + page + '&limit=100', {
      muteHttpExceptions: true, headers: { 'XSRF-TOKEN': token, Cookie: cookies }
    });
    if (result.getResponseCode() !== 200) throw new Error('Catalog unavailable');
    const data = JSON.parse(result.getContentText());
    if (data.sc !== 200 || !data.d || !Array.isArray(data.d.data)) throw new Error('Catalog changed');
    data.d.data.forEach(function (v) {
      if (!/^\d+$/.test(String(v.slug))) return;
      const type = /นิยาย|novel/i.test(v.main_category || '') ? 'LN (TH)' : /มังงะ|การ์ตูน/i.test(v.main_category || '') ? 'Manga (TH)' : '';
      const item = releaseItem_('luckpim', v.title, 'https://www.luckpim.com/product/detail/' + v.slug, v.price_sale == null ? v.price : v.price_sale, '', type);
      item.availability = v.pre_order === 'T' ? 'Pre-order' : Number(v.stock) > 0 ? 'In stock' : 'Check availability';items.push(item);
    });
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
