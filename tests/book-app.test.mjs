import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHarness } from './gas-harness.mjs';

const input={isbn:'',series:'A new story',type:'Manga (TH)',publisher:'New publisher',status:'Sealed',volume:'14.5',source:'New bookshop',price:'0',date:'2026-10-09',note:''};
const existing={...input,series:'Already on the shelf',isbn:'9780140328721',volume:1,price:120};
const save=(id,book=input,extra={})=>({requestId:id,book,...extra});

test('Apps Script and browser source both parse',()=>{
  new vm.Script(readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'));
  const html=readFileSync(new URL('../apps-script/Index.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  for(const script of scripts)new vm.Script(script);
  assert.equal(scripts.length,2);
  assert.equal(JSON.parse(readFileSync(new URL('../apps-script/appsscript.json',import.meta.url))).webapp.access,'MYSELF');
});
test('ISBN checksum, prefix, formatting, equivalence and invalid barcodes',()=>{
  const {api}=createHarness();
  assert.equal(api.normalizeIsbn_('ISBN-13: 978-0-140-32872-1'),'9780140328721');
  assert.equal(api.normalizeIsbn_('0-8044-2957-X'),'080442957X');
  assert.equal(api.canonicalIsbn_('0140328726'),'9780140328721');
  assert.equal(api.normalizeIsbn_(''), '');
  for(const value of ['9780140328722','1920079006008','978abc0140328721','1234567890','978014032872100'])assert.throws(()=>api.normalizeIsbn_(value),/not valid/);
});
test('numeric/date validation preserves zero and fractional volumes',()=>{
  const {api}=createHarness();const values=api.normalizeBook_(input);
  assert.equal(values[5],14.5);assert.equal(values[7],0);assert.equal(values[8],46304);
  assert.equal(api.normalizeBook_({...input,price:''})[7],'');
  for(const date of ['2026-02-30','2026-13-01','26-10-09'])assert.throws(()=>api.normalizeBook_({...input,date}),/valid date/);
  for(const price of ['-1','Infinity','1e4','oops'])assert.throws(()=>api.normalizeBook_({...input,price}),/non-negative/);
  assert.throws(()=>api.normalizeBook_({...input,series:''}),/series/);
});
test('setup keeps existing books and adjacent summaries, creates helpers only',()=>{
  const h=createHarness([existing]);h.put(2,14,120,'SUM(Table1[Price])');const before=h.row(2);h.setup();h.setup();
  assert.deepEqual(h.row(2),before);assert.equal(h.store().size,4);assert.ok(h.store().get('_BookAppTrash').hidden);
});
test('add expands native table and dropdowns; ISBN and formula-looking notes stay text',()=>{
  const h=createHarness([existing]);h.setup();h.put(2,14,120,'SUM(Table1[Price])');const summary=h.row(2)[13];
  h.api.saveBook(save('request_add_0001',{...input,isbn:'9780804429573',note:'=IMPORTXML("https://example.invalid","//x")'}));
  assert.equal(h.table().range.endRowIndex,3);assert.equal(h.row(3)[0].value,'9780804429573');assert.equal(h.row(3)[9].formula,undefined);
  assert.equal(h.row(3)[9].value,'=IMPORTXML("https://example.invalid","//x")');assert.deepEqual(h.row(2)[13],summary);
  const c=h.table().columnProperties.find(c=>c.columnIndex===3);assert.ok(c.dataValidationRule.condition.values.some(v=>v.userEnteredValue==='New publisher'));
  const update=h.calls[0].requests.find(r=>r.updateTable);assert.match(update.updateTable.fields,/range/);assert.match(update.updateTable.fields,/columnProperties/);
  const date=h.api.getCollection().books.find(b=>b.row===3).date;assert.equal(date,'2026-10-09');
});
test('table expansion clears an overlapping regular filter before updating the table',()=>{
  const h=createHarness([existing]);h.setup();h.put(2,14,120,'SUM(Table1[Price])');const before=h.row(2);
  // This filter starts in the new row, outside the table's original range.
  h.setBasicFilter({range:{sheetId:0,startRowIndex:2,endRowIndex:20,startColumnIndex:0,endColumnIndex:10}});
  h.api.saveBook(save('request_filter_add'));
  const requests=h.calls[0].requests;
  assert.ok(requests.findIndex(r=>r.clearBasicFilter)>=0);
  assert.ok(requests.findIndex(r=>r.clearBasicFilter)<requests.findIndex(r=>r.updateTable));
  assert.equal(h.basicFilter(),undefined);assert.equal(h.table().range.endRowIndex,3);
  assert.deepEqual(h.row(2),before);assert.equal(h.row(3)[1].value,input.series);
});
test('dropdown-only table updates also clear overlapping regular filters',()=>{
  const h=createHarness([existing]);h.setup();h.setBasicFilter({range:{sheetId:0,endRowIndex:2,endColumnIndex:10}});
  const b=h.api.getCollection().books[0];
  h.api.saveBook(save('request_filter_edit',{...existing,publisher:'Another publisher'},{row:b.row,token:b.token}));
  const requests=h.calls[0].requests;
  assert.equal(requests[0].clearBasicFilter.sheetId,0);
  assert.equal(requests[1].updateTable.fields,'columnProperties');
  assert.equal(h.basicFilter(),undefined);assert.equal(h.row(2)[3].value,'Another publisher');
});
test('unbounded regular filters are cleared, including when the sheet grid grows',()=>{
  const h=createHarness([existing]);h.setup();h.setMaxRows(2);h.setBasicFilter({range:{}});
  h.api.saveBook(save('request_filter_grid'));
  const requests=h.calls[0].requests;
  assert.ok(requests.some(r=>r.appendDimension));assert.ok(requests.some(r=>r.clearBasicFilter));
  assert.equal(h.store().get('Sheet1').maxRows,3);assert.equal(h.basicFilter(),undefined);
});
test('table updates preserve adjacent regular filters and filters backed by tables',()=>{
  for(const filter of [
    {range:{sheetId:0,startColumnIndex:10,endColumnIndex:14}},
    {range:{sheetId:0,startRowIndex:3,endRowIndex:20,startColumnIndex:0,endColumnIndex:10}},
    {tableId:'table1-id',range:{sheetId:0,endRowIndex:2,endColumnIndex:10},criteria:{4:{hiddenValues:['Read']}}}
  ]){
    const h=createHarness([existing]);h.setup();h.setBasicFilter(filter);
    h.api.saveBook(save('request_keep_filter'));
    assert.deepEqual(h.basicFilter(),filter);assert.equal(h.calls[0].requests.some(r=>r.clearBasicFilter),false);
    assert.equal(h.table().range.endRowIndex,3);
  }
});
test('ordinary cell edits preserve regular filters when no table update is needed',()=>{
  const h=createHarness([existing]);h.setup();const filter={range:{sheetId:0,endRowIndex:2,endColumnIndex:10}};h.setBasicFilter(filter);
  const b=h.api.getCollection().books[0];
  h.api.saveBook(save('request_keep_edit',{...existing,publisher:'Kodansha',source:'Kinokuniya',status:'Read'},{row:b.row,token:b.token}));
  assert.deepEqual(h.basicFilter(),filter);assert.equal(h.calls[0].requests.some(r=>r.updateTable||r.clearBasicFilter),false);
});
test('restoring a book clears a conflicting regular filter during its table update',()=>{
  const h=createHarness([existing]);h.setup();const b=h.api.getCollection().books[0];
  const removed=h.api.removeBook({requestId:'request_filter_remove',row:b.row,token:b.token});
  h.setBasicFilter({range:{sheetId:0,endColumnIndex:10}});
  h.api.restoreBook({requestId:'request_filter_restore',trashId:removed.trashId});
  assert.equal(h.basicFilter(),undefined);assert.equal(h.api.getCollection().books.length,1);assert.equal(h.api.getCollection().trash.length,0);
});
test('failed saves preserve the overlapping filter, books and retry receipts together',()=>{
  const h=createHarness([existing]);h.setup();const before=h.row(2),tableBefore=h.table();
  const filter={range:{sheetId:0,endRowIndex:20,endColumnIndex:10},criteria:{4:{hiddenValues:['Read']}}};h.setBasicFilter(filter);
  const batch=h.api.Sheets.Spreadsheets.batchUpdate;
  h.api.Sheets.Spreadsheets.batchUpdate=(body,id)=>batch({requests:[...body.requests,{updateTable:{table:{tableId:'missing-table'},fields:'range'}}]},id);
  assert.throws(()=>h.api.saveBook(save('request_filter_fail')),/Wrong table/);
  assert.deepEqual(h.basicFilter(),filter);assert.deepEqual(h.table(),tableBefore);assert.deepEqual(h.row(2),before);
  assert.equal(h.api.getCollection().books.length,1);assert.equal(h.store().get('_BookAppOperations').rows.length,1);
  h.api.Sheets.Spreadsheets.batchUpdate=batch;
  h.api.saveBook(save('request_filter_fail'));h.api.saveBook(save('request_filter_fail'));
  assert.equal(h.api.getCollection().books.length,2);assert.equal(h.calls.length,2);
});
test('request receipts prevent duplicate adds even after a lost response; conflicting reuse rejected',()=>{
  const h=createHarness();h.setup();const request=save('request_retry_01');const first=h.api.saveBook(request);const second=h.api.saveBook(request);
  assert.equal(JSON.stringify(first),JSON.stringify(second));assert.equal(h.api.getCollection().books.length,1);assert.equal(h.calls.length,1);
  assert.throws(()=>h.api.saveBook(save(request.requestId,{...input,series:'Different'})),/different change/);
});
test('equivalent ISBN-10 and ISBN-13 duplicate blocked; deliberate copy allowed',()=>{
  const h=createHarness([existing]);h.setup();
  assert.throws(()=>h.api.saveBook(save('request_dup_0001',{...input,isbn:'0140328726'})),/already in your collection/);
  h.api.saveBook(save('request_dup_0002',{...input,isbn:'0140328726'},{allowDuplicate:true}));assert.equal(h.api.getCollection().books.length,2);
});
test('edited or moved rows cannot be overwritten or removed with a stale token',()=>{
  const h=createHarness([existing,{...input,series:'Second'}]);h.setup();const b=h.api.getCollection().books[0];h.put(2,2,'Manually changed');
  assert.throws(()=>h.api.saveBook(save('request_stale_01',input,{row:b.row,token:b.token})),/changed or moved/);
  assert.throws(()=>h.api.removeBook({requestId:'request_stale_02',row:b.row,token:b.token}),/changed or moved/);assert.equal(h.calls.length,0);
});
test('current edit preserves row; formula rows are protected',()=>{
  const h=createHarness([existing]);h.setup();let b=h.api.getCollection().books[0];h.api.saveBook(save('request_edit_001',{...existing,status:'Read'},{row:b.row,token:b.token}));assert.equal(h.row(2)[4].value,'Read');
  h.put(2,10,'computed','=CONCAT("x","y")');b=h.api.getCollection().books[0];assert.equal(b.hasFormula,true);
  assert.throws(()=>h.api.removeBook({requestId:'request_formula1',row:b.row,token:b.token}),/contains a formula/);
});
test('remove archives and clears only A:J, restore preserves legacy values, retries are safe',()=>{
  const legacy={...existing,isbn:'not-yet-an-isbn',price:'',volume:14.5};const h=createHarness([legacy]);h.setup();h.put(2,14,999,'SUM(Table1[Price])');const original=h.row(2);const b=h.api.getCollection().books[0];
  const request={requestId:'request_remove01',row:b.row,token:b.token};const removed=h.api.removeBook(request);h.api.removeBook(request);
  assert.equal(h.api.getCollection().books.length,0);assert.equal(h.api.getCollection().trash.length,1);assert.deepEqual(h.row(2)[13],original[13]);
  const batch=h.calls[0].requests;assert.ok(batch.some(r=>r.appendCells?.sheetId===2));assert.equal(batch.find(r=>r.repeatCell).repeatCell.range.endColumnIndex,10);
  const restore={requestId:'request_restore1',trashId:removed.trashId};h.api.restoreBook(restore);h.api.restoreBook(restore);
  assert.equal(h.api.getCollection().books.length,1);assert.equal(h.api.getCollection().trash.length,0);assert.deepEqual(h.row(2).slice(0,10),original.slice(0,10));
  assert.throws(()=>h.api.restoreBook({...restore,requestId:'request_restore2'}),/already been restored/);
});
test('failed atomic batch cannot clear the book or create a recovery receipt',()=>{
  const h=createHarness([existing]);h.setup();const b=h.api.getCollection().books[0];h.failNextBatch();assert.throws(()=>h.api.removeBook({requestId:'request_atomic01',row:b.row,token:b.token}),/validation failure/);
  assert.equal(h.api.getCollection().books.length,1);assert.equal(h.api.getCollection().trash.length,0);assert.equal(h.store().get('_BookAppOperations').rows.length,1);
});
test('first free book row ignores summaries, preserves zero-price books, grows grid if full',()=>{
  const h=createHarness([existing]);h.setup();h.put(3,14,'summary');h.api.saveBook(save('request_free_001'));assert.equal(h.row(3)[1].value,input.series);assert.equal(h.row(3)[13].value,'summary');
  h.setMaxRows(3);h.api.saveBook(save('request_grow_001',{...input,series:'More'}));assert.equal(h.store().get('Sheet1').maxRows,4);assert.ok(h.calls[1].requests.some(r=>r.appendDimension));
});
test('header mismatch and held lock fail without mutation',()=>{
  const h=createHarness([existing]);h.setup();h.put(1,2,'Different heading');assert.throws(()=>h.api.saveBook(save('request_schema01')),/columns.*changed/);assert.equal(h.calls.length,0);
  const other=createHarness();other.setup();other.setLocked(true);assert.throws(()=>other.api.saveBook(save('request_locked01')),/Another change/);
});
test('lookup requires exact ISBN match, falls back on outages, caches success',()=>{
  const h=createHarness();h.api.responses=[{match:'googleapis',body:{items:[{volumeInfo:{title:'Wrong edition',industryIdentifiers:[{identifier:'9780804429573'}]}}]}},{match:'openlibrary',body:{'ISBN:9780140328721':{title:'Matilda',publishers:[{name:'Puffin'}],authors:[{name:'Roald Dahl'}]}}}];
  let r=h.api.lookupIsbn('0140328726');assert.equal(r.details.title,'Matilda');assert.equal(r.details.source,'Open Library');assert.equal(h.fetches.length,2);r=h.api.lookupIsbn('9780140328721');assert.equal(h.fetches.length,2);
  const outage=createHarness();outage.api.responses=[{match:'googleapis',status:429},{match:'openlibrary',status:503}];r=outage.api.lookupIsbn('9780140328721');assert.equal(r.found,false);assert.equal(r.warnings.length,2);
});
test('store check reads current ISBN matches, handles ISBN-10 equivalence and never writes',()=>{
  const h=createHarness([existing,{...input,series:'Unindexed volume'}]);h.setup();
  const result=h.api.checkOwnership('0-140-32872-6');
  assert.equal(result.matches.length,1);assert.equal(result.matches[0].series,existing.series);assert.equal(result.unindexedCount,1);assert.equal(result.totalCount,2);
  assert.equal(h.calls.length,0);assert.equal(h.fetches.length,0);
  h.put(2,1,'9780804429573');assert.equal(h.api.checkOwnership('9780140328721').matches.length,0);
  assert.throws(()=>h.api.checkOwnership(''),/Enter or scan/);assert.throws(()=>h.api.checkOwnership('9780140328722'),/not valid/);
});
test('no ISBN match reports incomplete coverage and excludes removed books',()=>{
  const h=createHarness([existing,{...input,isbn:'invalid old value'}]);h.setup();const current=h.api.getCollection().books[0];
  h.api.removeBook({requestId:'request_check_remove',row:current.row,token:current.token});
  const result=h.api.checkOwnership(existing.isbn);assert.equal(result.matches.length,0);assert.equal(result.totalCount,1);assert.equal(result.unindexedCount,1);
  const indexed=createHarness([existing]);assert.equal(indexed.api.checkOwnership('9780804429573').unindexedCount,0);
});
test('adding ISBN changes only its cell and preserves other values and formulas',()=>{
  const h=createHarness([{...input,price:'',volume:14.5}]);h.setup();h.put(2,10,'calculated','=CONCAT("a","b")');h.put(2,14,999,'SUM(Table1[Price])');
  const before=h.row(2),book=h.api.getCollection().books[0];
  const request={requestId:'request_link_isbn',row:book.row,token:book.token,isbn:'0-140-32872-6'};
  h.api.setBookIsbn(request);h.api.setBookIsbn(request);
  assert.equal(h.row(2)[0].value,'0140328726');assert.deepEqual(h.row(2).slice(1),before.slice(1));assert.equal(h.calls.length,1);
  assert.equal(h.api.checkOwnership('9780140328721').matches.length,1);
  assert.equal(h.calls[0].requests.find(r=>r.updateCells).updateCells.rows[0].values.length,1);
});
test('adding ISBN prevents stale-row edits, duplicates, blank ISBNs and formula replacement',()=>{
  const h=createHarness([existing,input]);h.setup();let b=h.api.getCollection().books[1];
  const request={requestId:'request_isbn_dup1',row:b.row,token:b.token,isbn:'0140328726'};
  assert.throws(()=>h.api.setBookIsbn(request),/another book/);h.api.setBookIsbn({...request,requestId:'request_isbn_copy',allowDuplicate:true});assert.equal(h.api.checkOwnership(existing.isbn).matches.length,2);
  assert.throws(()=>h.api.setBookIsbn({...request,requestId:'request_isbn_stale'}),/changed or moved/);
  b=h.api.getCollection().books[1];assert.throws(()=>h.api.setBookIsbn({...request,requestId:'request_isbn_blank',token:b.token,isbn:''}),/Enter or scan/);
  h.put(3,1,'computed','=CONCAT("978","0140328721")');b=h.api.getCollection().books[1];
  assert.throws(()=>h.api.setBookIsbn({...request,requestId:'request_isbn_formula',token:b.token}),/ISBN cell contains a formula/);
});
test('an unsuccessful ISBN batch leaves the original volume and receipt unchanged',()=>{
  const h=createHarness([input]);h.setup();const b=h.api.getCollection().books[0],before=h.row(2);h.failNextBatch();
  assert.throws(()=>h.api.setBookIsbn({requestId:'request_link_atomic',row:b.row,token:b.token,isbn:existing.isbn}),/validation failure/);
  assert.deepEqual(h.row(2),before);assert.equal(h.store().get('_BookAppOperations').rows.length,1);
});
