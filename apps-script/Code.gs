/** Book Collection — bound to the existing spreadsheet; deploy with access Only myself. */
const BOOK_APP = Object.freeze({
  spreadsheetId: '1xtA2hqEGZPyvQS0ZC2NI30lJLJAugvFHPh9jQOyGhgg',
  sheetName: 'Sheet1', tableName: 'Table1',
  trashName: '_BookAppTrash', operationsName: '_BookAppOperations',
  headers: ['ISBN', 'Series', 'Type', 'Publisher', 'Status', 'Volume', 'Source', 'Price', 'Date', 'Note'],
  fields: ['isbn', 'series', 'type', 'publisher', 'status', 'volume', 'source', 'price', 'date', 'note'],
  statuses: ['Sealed', 'Un Sealed', 'Reading', 'Read'],
  types: ['LN (EN)', 'Manga (JP) (Color)', 'Manga (TH)', 'LN (TH)', 'Manga (JP)', 'Manga (TH) (Color)', 'Other']
});
const TRASH_HEADERS = ['Trash ID', 'Removed At', 'State', 'Original Row', 'Book JSON'];
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

/** Run once from the editor. Creates two helper tabs; never rewrites collection data. */
function setupBookApp() {
  return withLock_(function () {
    const context = context_();
    tableState_(context); // Also checks that the Sheets advanced service is enabled.
    [[BOOK_APP.trashName, TRASH_HEADERS], [BOOK_APP.operationsName, OP_HEADERS]].forEach(function (spec) {
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
    sheetUrl: c.ss.getUrl(), timeZone: c.timeZone
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
  const cached = cache.get('isbn:' + canonical);
  if (cached) return JSON.parse(cached);
  const warnings = [];
  let details = null;
  try {
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
  const result = { isbn: isbn, found: !!details, details: details, warnings: warnings };
  if (details) cache.put('isbn:' + canonical, JSON.stringify(result), 21600);
  return result;
}

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
