import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHarness } from '../tests/gas-harness.mjs';
const fixture=JSON.parse(readFileSync(new URL('./books.json',import.meta.url)));
// Exported numeric ISBNs can be scientific notation; SpreadsheetApp returns them as numbers.
fixture.forEach(book=>{if(typeof book.isbn==='string'&&/^\d+(?:\.\d+)?e\+?\d+$/i.test(book.isbn)&&Number.isSafeInteger(Number(book.isbn)))book.isbn=Number(book.isbn);});
const h=createHarness(fixture);h.setup();
const releaseExamples=JSON.parse(readFileSync(new URL('./releases.json',import.meta.url)));
const naiinSearch=readFileSync(new URL('../tests/fixtures/publishers/naiin-search.html',import.meta.url),'utf8');
const naiinDetail=readFileSync(new URL('../tests/fixtures/publishers/naiin-detail.html',import.meta.url),'utf8');
const shim=`<script>
function previewRunner(success=()=>{},failure=()=>{}) { return new Proxy({}, {get(_,name){
  if(name==='withSuccessHandler')return fn=>previewRunner(fn,failure);
  if(name==='withFailureHandler')return fn=>previewRunner(success,fn);
  return async arg=>{try{const response=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arg})});const value=await response.json();if(!response.ok)throw Error(value.message);success(value);}catch(error){failure(error);}};
}}); }
window.google={script:{run:previewRunner()}};
document.addEventListener('DOMContentLoaded',()=>{const banner=document.createElement('div');banner.textContent='Preview only — changes are temporary and do not update your Google Sheet.';banner.style.cssText='position:sticky;top:0;z-index:5;background:#edf0d6;color:#4e582b;text-align:center;padding:9px 16px;font:12px system-ui';document.body.prepend(banner);});
</script>`;
const server=http.createServer(async(req,res)=>{
  const send=(code,data,type='application/json')=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(data):data);};
  if(req.url==='/'&&req.method==='GET')return send(200,readFileSync(new URL('../apps-script/Index.html',import.meta.url),'utf8').replace('<script src=',shim+'\n<script src='),'text/html; charset=utf-8');
  if(req.url==='/rpc'&&req.method==='POST'){
    try{let body='';for await(const chunk of req){body+=chunk;if(body.length>20000)throw Error('Request too large');}const {name,arg}=JSON.parse(body);if(!['getCollection','saveBook','removeBook','restoreBook','lookupIsbn','checkOwnership','setBookIsbn','getPublisherReleases','setSavedRelease'].includes(name))return send(404,{message:'Unknown preview action'});
      if(name==='getPublisherReleases'){if(!releaseExamples[arg?.publisherId])throw Error('Choose a supported publisher.');return send(200,{publisherId:arg.publisherId,items:releaseExamples[arg.publisherId],checkedAt:'',stale:false,error:'',example:true});}
      if(name==='lookupIsbn'&&h.api.canonicalIsbn_(arg)==='9786166247275'){h.api.responses=[{match:'search-result',text:naiinSearch},{match:'product/detail/716295',text:naiinDetail}];return send(200,h.api.lookupIsbn(arg));}
      if(name==='lookupIsbn'){const isbn=h.api.normalizeIsbn_(arg);return send(200,{isbn,found:!!isbn,details:isbn?{title:'Matilda (preview example)',publisher:'Puffin',authors:'Roald Dahl',source:'Preview example'}:null,warnings:[]});}
      const result=h.api[name](arg);if(name==='getCollection')result.preview=true;return send(200,result);
    }catch(error){return send(400,{message:error.message});}
  }send(404,{message:'Not found'});
});
server.listen(8765,'127.0.0.1',()=>console.log('Book Collection preview: http://localhost:8765'));
