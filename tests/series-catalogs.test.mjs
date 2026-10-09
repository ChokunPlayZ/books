import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness } from './gas-harness.mjs';
const fixture = name => readFileSync(new URL('./fixtures/series-catalogs/' + name, import.meta.url), 'utf8');
const series = 'ดอกรักผลิบานที่กลางใจ', url = 'https://www.phoenixnext.com/book-series/kaoru-hana-wa-rin-to-saku.html';
const request = { series, publisherId: 'phoenix', type: 'Manga (TH)' };
const responses = () => [{ match: 'book-series.html', text: fixture('phoenix-directory.html') }, { match: 'kaoru-hana-wa-rin-to-saku.html', text: fixture('phoenix-category.html') }];
const card = volume => '<a class="product-item-link" href="https://www.phoenixnext.com/catalog-vol-' + volume + '.html">(มังงะ) ' + series + ' เล่ม ' + volume + '</a><span data-price-amount="175"></span>';
const page = (volumes, total = 3) => '<title>' + series + '</title><span class="toolbar-number">' + total + '</span>' + volumes.map(card).join('');

test('publisher directories find exact Thai titles, English category slugs and distinct manga/novel categories', () => {
  const h = createHarness(), phoenix = h.api.parseSeriesCategories_('phoenix', fixture('phoenix-directory.html')), first = h.api.parseSeriesCategories_('firstpage', fixture('firstpage-directory.html'));
  assert.ok(phoenix.length > 400); assert.equal(h.api.matchSeriesCategory_(series, phoenix).url, url);
  assert.equal(h.api.matchSeriesCategory_('Bocchi The Rock', phoenix).url, 'https://www.phoenixnext.com/book-series/bocchi-the-rock.html');
  const manga = h.api.matchSeriesCategory_('ผู้กล้าโล่ผงาด', first, 'Manga (TH)'), novel = h.api.matchSeriesCategory_('ผู้กล้าโล่ผงาด', first, 'LN (TH)');
  assert.ok(manga && novel); assert.notEqual(manga.url, novel.url); assert.equal(h.api.matchSeriesCategory_('ผู้กล้าโล่ผงาด', first), null);
  assert.equal(h.api.matchSeriesCategory_('An unknown spelling', phoenix), null);
});
test('Phoenix reads all series listings, caches them, retains variants, and never reads the recent-release page', () => {
  const h = createHarness(); h.api.responses = responses();
  const catalog = h.api.getSeriesCatalog(request);
  assert.equal(catalog.complete, true); assert.equal(catalog.total, 32); assert.equal(catalog.items.length, 32); assert.equal(catalog.url, url);
  assert.ok(catalog.items.some(item => item.volume === 22)); assert.ok(catalog.items.some(item => item.volume === 6));
  assert.ok(catalog.items.some(item => item.catalogVariant && !item.special));
  assert.ok(catalog.items.every(item => item.catalogSeries === series)); assert.equal(h.calls.length, 0);
  const count = h.fetches.length; h.api.getSeriesCatalog(request); assert.equal(h.fetches.length, count);
  h.api.getSeriesCatalog({ ...request, refresh: true }); assert.ok(h.fetches.length > count); assert.ok(h.fetches.every(u => !u.includes('new-release')));
});
test('First Page Pro category contains older volumes beyond a recent feed', () => {
  const h = createHarness(); h.api.responses = [{ match: '/category/56', text: fixture('firstpage-category.html') }, { match: 'firstpagepro.com/', text: fixture('firstpage-directory.html') }];
  const result = h.api.getSeriesCatalog({ publisherId: 'firstpage', series: 'ชิชุนกิจัง สาวใสวัยลองรัก', type: 'Manga (TH)' });
  assert.equal(result.complete, true); assert.equal(result.items.length, 11); assert.equal(result.url, 'https://www.firstpagepro.com/category/56');
  assert.deepEqual(Array.from(result.items.map(item => item.volume)).sort((a,b) => a-b), [1,2,3,4,5,6,7,8,9,10,11]);
});
test('category pagination follows every counted page, deduplicates products, and flags repeated or uncounted pages', () => {
  for (const publisherId of ['phoenix', 'firstpage']) {
    const h = createHarness(), source = publisherId === 'phoenix' ? url : 'https://www.firstpagepro.com/category/56';
    const markup = publisherId === 'phoenix' ? page : (volumes,total) => '<h1>Series</h1><span class="tsk-all">' + total + '</span>' + volumes.map(v => '<div class="productArea productItem"><a class="gadgetThumbnail" title="การ์ตูน Series เล่ม '+v+'" href="https://www.firstpagepro.com/product/'+v+'"></a></div>').join('');
    h.api.responses = [{ match: '?', text: markup([2,3],3) }, { match: source, text: markup([1,2],3) }];
    const result = h.api.fetchSeriesCategory_(publisherId, source); assert.equal(result.complete, true); assert.equal(result.items.length, 3); assert.equal(result.pages, 2);
    assert.ok(h.fetches[1].endsWith(publisherId === 'phoenix' ? '?p=2' : '?tskp=2'));
  }
  const repeated = createHarness(); repeated.api.responses = [{ match: url, text: page([1],3) }];
  const partial = repeated.api.fetchSeriesCategory_('phoenix', url); assert.equal(partial.complete, false); assert.equal(partial.pages, 2); assert.equal(partial.items.length, 1);
  const uncounted = createHarness(); uncounted.api.responses = [{ match: url, text: card(1) }]; assert.equal(uncounted.api.fetchSeriesCategory_('phoenix', url).complete, false);
  const empty = createHarness(); empty.api.responses = [{ match: url, text: page([],0) }]; assert.equal(empty.api.fetchSeriesCategory_('phoenix', url).complete, true);
  const changed = createHarness(); changed.api.responses = [{ match: url, text: '<html>No catalog markup</html>' }]; assert.throws(() => changed.api.fetchSeriesCategory_('phoenix', url), /markup/);
});
test('a category reaching the page limit stays incomplete; an outage preserves only the previous checked result', () => {
  const h = createHarness(); h.api.UrlFetchApp.fetch = address => { h.fetches.push(address); const volume = Number(address.match(/\?p=(\d+)/)?.[1] || 1); return { getResponseCode: () => 200, getContentText: () => page([volume],25) }; };
  const capped = h.api.fetchSeriesCategory_('phoenix',url); assert.equal(capped.pages,20); assert.equal(capped.items.length,20); assert.equal(capped.complete,false);
  const cached = createHarness(); cached.api.responses = responses(); const fresh = cached.api.getSeriesCatalog(request);
  cached.api.responses = [{ match: url, status: 503 }, { match: 'book-series.html', text: fixture('phoenix-directory.html') }];
  const stale = cached.api.getSeriesCatalog({ ...request, refresh:true }); assert.equal(stale.stale,true); assert.equal(stale.checkedAt,fresh.checkedAt); assert.equal(stale.items.length,32); assert.match(stale.error,/previous check/);
});
test('unknown or ambiguous category names request a choice instead of returning an empty complete catalog', () => {
  const h = createHarness(); h.api.responses = responses();
  const result = h.api.getSeriesCatalog({ ...request, series:'An unfamiliar translation' });
  assert.equal(result.needsSelection,true); assert.equal(result.complete,false); assert.ok(result.categories.length > 400); assert.equal(result.checkedAt,'');
  assert.ok(h.fetches.every(address => !address.includes('new-release')));
});
test('manual links survive reloads, remain separate by edition, and never change owned book cells', () => {
  const h = createHarness([{series:'English shelf title',type:'Manga (TH)',publisher:'PHOENIX Next',volume:1,status:'Read'}]); h.setup();
  const spec = {...request,series:'English shelf title'}, before=JSON.stringify(h.api.getCollection().books);
  h.api.setSeriesCatalog({...spec,url,title:series}); h.api.setSeriesCatalog({...spec,url,title:series});
  assert.equal(h.store().get('_BookAppSeriesCatalogs').rows.length,2); assert.equal(h.store().get('_BookAppSeriesCatalogs').hidden,true);
  h.api.responses=responses(); const linked=h.api.getSeriesCatalog(spec); assert.equal(linked.complete,true); assert.equal(linked.items[0].catalogSeries,spec.series); assert.equal(linked.items.find(i=>i.volume===6).catalogVariant,false);
  const variant=linked.items.find(item=>item.catalogVariant);
  h.api.setSavedRelease({release:variant,saved:true});const snapshot=h.api.getCollection().savedReleases[0];assert.equal(snapshot.catalogSeries,spec.series);assert.equal(snapshot.catalogVariant,true);
  assert.equal(JSON.stringify(h.api.getCollection().books),before);
  h.api.setSeriesCatalog({...spec,type:'LN (TH)',url,title:'Separate novel category'}); assert.equal(h.store().get('_BookAppSeriesCatalogs').rows.length,3);
  for(const bad of ['https://evil.test/category/56','https://www.phoenixnext.com.evil.test/book-series/a.html','http://www.phoenixnext.com/book-series/a.html','https://www.phoenixnext.com/new-release.html','https://www.firstpagepro.com/category/56'])assert.throws(()=>h.api.setSeriesCatalog({...spec,url:bad}),/category URL/);
  const saved=JSON.stringify(h.store().get('_BookAppSeriesCatalogs').rows);h.failNextBatch();assert.throws(()=>h.api.setSeriesCatalog({...spec,url:'https://www.phoenixnext.com/book-series/bocchi-the-rock.html'}),/Simulated/);assert.equal(JSON.stringify(h.store().get('_BookAppSeriesCatalogs').rows),saved);
});
test('Luckpim uses its full search, keeps stock/pre-orders and parses promotional volume suffixes', () => {
  const h=createHarness();h.api.responses=[{match:'get/search_pin/key',body:JSON.parse(fixture('luckpim-series.json'))},{match:'luckpim.com/',text:'<input name=__RequestVerificationToken value=public-token>',headers:{'Set-Cookie':'catalog-session=test; Path=/'}}];
  const result=h.api.getSeriesCatalog({publisherId:'luckpim',series:'เกมสารภาพรักนี้น่ะ เรามาจบมันกันเถอะ',type:'Manga (TH)'});
  assert.equal(result.complete,true);assert.equal(result.search,true);assert.equal(result.items.length,7);assert.deepEqual(Array.from(result.items.filter(i=>!i.special).map(i=>i.volume)),[6,5,4,3,2,1]);
  assert.ok(h.fetches[1].includes('limit=-1'));assert.ok(!h.fetches[1].includes('take='));assert.ok(h.fetches.every(u=>!u.includes('setting=new')));
  h.api.responses[0].body=JSON.parse(fixture('luckpim-makeine.json'));
  const manga=h.api.getSeriesCatalog({publisherId:'luckpim',series:'รักครั้งนี้มีคนนกเยอะไปมั้ย!',type:'Manga (TH)'});
  assert.equal(manga.items.filter(i=>!i.special).every(i=>i.volume!==''&&!i.catalogVariant),true);assert.ok(manga.items.some(i=>i.availability==='Pre-order'));
  assert.equal(h.api.splitBookTitle_('การ์ตูน Series 5 (จบ) (Mg)').volume,5);
});
test('empty Luckpim searches ask for the right title, and response count mismatches stay incomplete',()=>{
  for(const data of [{list:[],total:0},{list:JSON.parse(fixture('luckpim-series.json')).data.list,total:20}]){
    const h=createHarness();h.api.responses=[{match:'get/search_pin/key',body:{status:200,data}},{match:'luckpim.com/',text:'<input name=__RequestVerificationToken value=public-token>'}];
    const result=h.api.getSeriesCatalog({publisherId:'luckpim',series:'Series',type:'Manga (TH)'});
    if(!data.list.length){assert.equal(result.needsSelection,true);assert.match(result.error,/No books/);}else{assert.equal(result.complete,false);assert.match(result.error,/incomplete/);}
  }
});
