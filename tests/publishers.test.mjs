import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHarness} from './gas-harness.mjs';
const fixture=name=>readFileSync(new URL('./fixtures/publishers/'+name,import.meta.url),'utf8');
const sample=h=>h.api.parseCatalog_('phoenix',fixture('phoenix.html'))[0];
const naiinResponses=[{match:'search-result',text:fixture('naiin-search.html')},{match:'product/detail/716295',text:fixture('naiin-detail.html')}];

test('current publisher card markup yields Thai titles, volume, price and safe stable book URLs',()=>{
  const h=createHarness(),phoenix=h.api.parseCatalog_('phoenix',fixture('phoenix.html')),first=h.api.parseCatalog_('firstpage',fixture('firstpage.html'));
  assert.equal(phoenix.length,3);assert.equal(phoenix[1].volume,16);assert.equal(phoenix[1].type,'LN (TH)');assert.equal(phoenix[0].isbn,'9786166247404');assert.equal(phoenix[0].price,370);
  assert.equal(first.length,2);assert.equal(first[0].volume,1);assert.equal(first[0].type,'Manga (TH)');assert.equal(first[0].url,'https://www.firstpagepro.com/product/1152');assert.equal(first[0].price,200);
  assert.deepEqual(Array.from(h.api.parseCatalog_('phoenix','<a href="https://evil.test/book.html" class="product-item-link">Bad title</a>')),[]);
});
test('catalog pagination uses each publisher parameter, deduplicates repeated products and caches successful checks',()=>{
  for(const [id,name,param] of [['phoenix','phoenixnext','?p=2'],['firstpage','firstpagepro','?tskp=2']]){
    const h=createHarness();h.api.responses=[{match:name,text:fixture(id+'.html')}];
    const first=h.api.getPublisherReleases({publisherId:id});assert.ok(first.items.length);assert.equal(h.fetches.length,2);assert.ok(h.fetches[1].endsWith(param));assert.equal(first.stale,false);
    h.api.getPublisherReleases({publisherId:id});assert.equal(h.fetches.length,2);
    h.api.getPublisherReleases({publisherId:id,refresh:true});assert.equal(h.fetches.length,4);
    assert.equal(first.items.length,id==='phoenix'?3:2);
  }
});
test('publisher outage keeps the previous check and clearly reports stale or unavailable feeds',()=>{
  const h=createHarness();h.api.responses=[{match:'phoenixnext',text:fixture('phoenix.html')}];const fresh=h.api.getPublisherReleases({publisherId:'phoenix'});
  h.api.responses=[{match:'phoenixnext',status:503}];const stale=h.api.getPublisherReleases({publisherId:'phoenix',refresh:true});assert.equal(stale.checkedAt,fresh.checkedAt);assert.equal(stale.items.length,3);assert.equal(stale.stale,true);assert.match(stale.error,/previous check/);
  const unavailable=h.api.getPublisherReleases({publisherId:'firstpage'});assert.equal(unavailable.items.length,0);assert.equal(unavailable.checkedAt,'');assert.match(unavailable.error,/could not read/i);
  assert.throws(()=>h.api.getPublisherReleases({publisherId:'https://evil.test'}),/supported publisher/);assert.equal(h.calls.length,0);
});
test('Luckpim public token and session cookie load structured monthly books and retain pre-order labels',()=>{
  const h=createHarness(),options=[];
  h.api.responses=[{match:'product/list/new',text:'<input name=__RequestVerificationToken type=hidden value=public-token>',headers:{'Set-Cookie':['catalog-session=public; Path=/;','catalog-mode=new; Secure']}},{match:'getBookList',body:JSON.parse(fixture('luckpim.json'))}];
  const fetch=h.api.UrlFetchApp.fetch;h.api.UrlFetchApp.fetch=(url,opts)=>{options.push(opts);return fetch(url,opts);};
  const feed=h.api.getPublisherReleases({publisherId:'luckpim'});assert.equal(feed.items.length,4);assert.equal(feed.items[1].series,'รักครั้งนี้มีคนนกเยอะไปมั้ย! @COMIC');assert.equal(feed.items[1].volume,5);assert.equal(feed.items[1].price,124);assert.equal(feed.items[1].availability,'Pre-order');assert.equal(feed.items[0].special,true);
  assert.equal(options[1].headers['XSRF-TOKEN'],'public-token');assert.equal(options[1].headers.Cookie,'catalog-session=public; catalog-mode=new');assert.equal(feed.items[1].url,'https://www.luckpim.com/product/detail/2847');
});
test('book title parsing preserves decimal volumes and does not assign ordinary ISBN ownership to special sets',()=>{
  const h=createHarness();assert.equal(h.api.splitBookTitle_('(LN) เรื่องหนึ่ง เล่ม 14.5').volume,14.5);
  assert.equal(h.api.splitBookTitle_('การ์ตูน เรื่องหนึ่ง 18 (จบ)').series,'เรื่องหนึ่ง');assert.equal(h.api.splitBookTitle_('86').volume,'');
  const special=h.api.releaseItem_('phoenix','(มังงะ) Special Set เรื่องหนึ่ง เล่ม 5','https://www.phoenixnext.com/mg1234.html',0,'9780140328721');assert.equal(special.special,true);assert.equal(special.isbn,'');assert.equal(special.price,0);
});
test('saved releases survive catalog changes, repeated saves and app reloads without adding owned books',()=>{
  const h=createHarness();h.setup();const item=sample(h),before=h.api.getCollection().books.length;
  const first=h.api.setSavedRelease({release:item,saved:true});assert.equal(first.savedReleases.length,1);h.api.setSavedRelease({release:item,saved:true});assert.equal(h.store().get('_BookAppReleases').rows.length,2);
  h.api.responses=[{match:'phoenixnext',status:503}];h.api.getPublisherReleases({publisherId:'phoenix',refresh:true});assert.equal(h.api.getCollection().savedReleases[0].id,item.id);assert.equal(h.api.getCollection().books.length,before);
  h.api.setSavedRelease({release:item,saved:false});h.api.setSavedRelease({release:item,saved:false});assert.equal(h.api.getCollection().savedReleases.length,0);assert.equal(h.store().get('_BookAppReleases').rows.length,2);assert.equal(h.calls.length,0);
});
test('existing installations create only the release helper on first save; invalid publisher links never get saved',()=>{
  const h=createHarness();h.setup();h.store().delete('_BookAppReleases');assert.equal(h.api.getCollection().savedReleases.length,0);
  const item=sample(h);h.api.setSavedRelease({release:item,saved:true});assert.ok(h.store().get('_BookAppReleases').hidden);
  const before=h.store().get('_BookAppReleases').rows.length;
  for(const url of ['javascript:alert(1)','https://www.phoenixnext.com.evil.test/book.html','https://www.phoenixnext.com/book.html?x=1','https://www.naiin.com/product/detail/716295'])assert.throws(()=>h.api.setSavedRelease({release:{...item,url},saved:true}),/missing/);
  assert.throws(()=>h.api.setSavedRelease({release:item,saved:'true'}),/Choose/);assert.equal(h.store().get('_BookAppReleases').rows.length,before);
});
test('Naiin exact edition metadata is preferred and cached; title search alone cannot confirm an ISBN',()=>{
  const h=createHarness();h.api.responses=naiinResponses;const r=h.api.lookupIsbn('978-616-624-727-5');assert.equal(r.found,true);assert.equal(r.details.source,'Naiin');assert.equal(r.details.series,'ดอกรักผลิบานที่กลางใจ');assert.equal(r.details.volume,22);assert.equal(r.details.type,'Manga (TH)');assert.equal(r.details.publisher,'PHOENIX Next');assert.equal(h.fetches.length,2);assert.ok(r.searchUrl.endsWith('9786166247275'));h.api.lookupIsbn('9786166247275');assert.equal(h.fetches.length,2);
  const mismatch=createHarness();mismatch.api.responses=naiinResponses;mismatch.api.lookupIsbn('9780140328721');assert.ok(mismatch.fetches.some(url=>url.includes('googleapis')));assert.ok(mismatch.fetches.some(url=>url.includes('openlibrary')));
});
test('Naiin empty search and service failure fall back, leaving a usable ISBN search link',()=>{
  for(const entry of [{match:'search-result',text:'<product-list :items=\'[]\'></product-list>'},{match:'search-result',status:503}]){
    const h=createHarness();h.api.responses=[entry,{match:'googleapis',body:{items:[{volumeInfo:{title:'Matilda',industryIdentifiers:[{identifier:'0140328726'}]}}]}}];
    const r=h.api.lookupIsbn('9780140328721');assert.equal(r.details.source,'Google Books');assert.equal(r.details.title,'Matilda');assert.ok(r.searchUrl.includes('9780140328721'));assert.equal(r.warnings.length,entry.status?1:0);
  }
});
