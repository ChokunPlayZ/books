import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const HEADERS = ['ISBN','Series','Type','Publisher','Status','Volume','Source','Price','Date','Note'];
const FIELDS = ['isbn','series','type','publisher','status','volume','source','price','date','note'];
const source = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const epoch = Date.UTC(1899,11,30);
export function createHarness(books = []) {
  let store = new Map();
  let table = { tableId:'table1-id', name:'Table1', range:{sheetId:0,startRowIndex:0,startColumnIndex:0,endRowIndex:Math.max(2,books.length+1),endColumnIndex:10}, columnProperties:[
    {columnIndex:2,columnName:'Type',columnType:'DROPDOWN',dataValidationRule:{condition:{type:'ONE_OF_LIST',values:['Manga (TH)','Manga (JP)','Other'].map(userEnteredValue=>({userEnteredValue}))}}},
    {columnIndex:3,columnName:'Publisher',columnType:'DROPDOWN',dataValidationRule:{condition:{type:'ONE_OF_LIST',values:[{userEnteredValue:'Kodansha'}]}}},
    {columnIndex:4,columnName:'Status',columnType:'DROPDOWN',dataValidationRule:{condition:{type:'ONE_OF_LIST',values:['Sealed','Un Sealed','Reading','Read'].map(userEnteredValue=>({userEnteredValue}))}}},
    {columnIndex:6,columnName:'Source',columnType:'DROPDOWN',dataValidationRule:{condition:{type:'ONE_OF_LIST',values:[{userEnteredValue:'Kinokuniya'}]}}}
  ] };
  store.set('Sheet1',{id:0,name:'Sheet1',maxRows:1000,hidden:false,rows:[HEADERS.map(value=>({value})),...books.map(b=>FIELDS.map((k,i)=>({value:i===8&&b[k]?new Date(b[k]+'T00:00:00+07:00'):b[k]??''}))) ]});
  store.set('SpentBreakdown',{id:1,name:'SpentBreakdown',maxRows:1000,hidden:false,rows:[[{value:'Source'},{value:'Total Spent'}]]});
  const cache=new Map(),calls=[],fetches=[];
  let locked=false,failBatch=false;
  function sheetData(id) { return [...store.values()].find(s=>s.id===id); }
  function lastRow(s) { let n=s.rows.length;while(n>0&&!s.rows[n-1]?.some(c=>c&&(c.value!==''&&c.value!==undefined||c.formula)))n--;return n; }
  function cellAt(s,r,c) { s.rows[r]??=[];s.rows[r][c]??={value:''};return s.rows[r][c]; }
  function range(s,r,c,n=1,m=1) {
    const getRows=kind=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>{const cell=s.rows[r+i-1]?.[c+j-1]||{value:''};if(kind==='formula')return cell.formula||'';return cell.value??'';}));
    return {getValues:()=>getRows('value'),getDisplayValues:()=>getRows('value').map(row=>row.map(v=>String(v))),getFormulas:()=>getRows('formula'),
      getDataValidations:()=>Array.from({length:n},()=>Array.from({length:m},(_,j)=>{const col=table.columnProperties.find(p=>p.columnIndex===c+j-1);return col?{getCriteriaType:()=> 'VALUE_IN_LIST',getCriteriaValues:()=>[col.dataValidationRule.condition.values.map(v=>v.userEnteredValue)]}:null;})),
      setValues:values=>values.forEach((row,i)=>row.forEach((v,j)=>cellAt(s,r+i-1,c+j-1).value=v))};
  }
  function sheet(s) { return {getName:()=>s.name,getSheetId:()=>s.id,getMaxRows:()=>s.maxRows,getLastRow:()=>lastRow(s),getRange:(...args)=>range(s,...args),setFrozenRows:()=>{},hideSheet:()=>{s.hidden=true;}}; }
  function applyCell(s,r,c,payload) {
    const cell=cellAt(s,r,c),v=payload.userEnteredValue;delete cell.formula;
    cell.value=!v?'':v.numberValue!==undefined?v.numberValue:v.stringValue!==undefined?v.stringValue:'';
    if(v?.formulaValue){cell.formula=v.formulaValue;cell.value='formula result';}
    // SpreadsheetApp exposes a date-formatted serial as a Date in the spreadsheet timezone.
    if(s.id===0&&c===8&&typeof cell.value==='number')cell.value=new Date(epoch+cell.value*86400000-7*3600000);
  }
  function batch(body) {
    calls.push(structuredClone(body));
    if(failBatch){failBatch=false;throw Error('Simulated API validation failure');}
    const savedStore=structuredClone(store),savedTable=structuredClone(table);
    try {
      for(const req of body.requests){
        if(req.appendDimension){const q=req.appendDimension;sheetData(q.sheetId).maxRows+=q.length;}
        else if(req.clearBasicFilter){delete sheetData(req.clearBasicFilter.sheetId).basicFilter;}
        else if(req.updateTable){
          if(req.updateTable.table.tableId!==table.tableId)throw Error('Wrong table');
          const target=req.updateTable.table.range||table.range,filter=sheetData(target.sheetId).basicFilter;
          if(filter?.range&&!filter.tableId){
            const r=filter.range;
            const overlaps=['Row','Column'].every(axis=>Math.max(target['start'+axis+'Index']??0,r['start'+axis+'Index']??0)<Math.min(target['end'+axis+'Index']??Infinity,r['end'+axis+'Index']??Infinity));
            if(overlaps)throw Error('Before converting your data into a table, please remove the filter that overlaps with the conversion area.');
          }
          Object.assign(table,structuredClone(req.updateTable.table));
        }
        else if(req.updateCells){const q=req.updateCells,s=sheetData(q.start.sheetId);q.rows.forEach((row,i)=>row.values.forEach((v,j)=>applyCell(s,q.start.rowIndex+i,q.start.columnIndex+j,v)));}
        else if(req.appendCells){const q=req.appendCells,s=sheetData(q.sheetId),start=lastRow(s);q.rows.forEach((row,i)=>row.values.forEach((v,j)=>applyCell(s,start+i,j,v)));}
        else if(req.repeatCell){const q=req.repeatCell,s=sheetData(q.range.sheetId);if(q.fields==='userEnteredValue')for(let r=q.range.startRowIndex;r<q.range.endRowIndex;r++)for(let c=q.range.startColumnIndex;c<q.range.endColumnIndex;c++)applyCell(s,r,c,q.cell);}
        else throw Error('Unsupported test request '+Object.keys(req)[0]);
      }
    }catch(error){store=savedStore;table=savedTable;throw error;}
    return {replies:body.requests.map(()=>({}))};
  }
  const sandbox = {
    Date,console,
    SpreadsheetApp:{openById:()=>({getSheetByName:name=>store.has(name)?sheet(store.get(name)):null,insertSheet:name=>{const s={id:store.size,name,maxRows:1000,rows:[]};store.set(name,s);return sheet(s);},getSpreadsheetTimeZone:()=> 'Asia/Bangkok',getUrl:()=> 'https://docs.google.com/spreadsheets/d/1xtA2hqEGZPyvQS0ZC2NI30lJLJAugvFHPh9jQOyGhgg/edit'}),DataValidationCriteria:{VALUE_IN_LIST:'VALUE_IN_LIST'}},
    LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})},
    Utilities:{getUuid:randomUUID,DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,t)=>[...createHash('sha256').update(t).digest()],base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url'),formatDate:(d,tz)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(d)},
    Sheets:{Spreadsheets:{get:(_,options)=>({sheets:[{properties:{sheetId:0},tables:[structuredClone(table)],...(options.fields.includes('basicFilter')?{basicFilter:structuredClone(store.get('Sheet1').basicFilter)}:{})}]}),batchUpdate:batch}},
    CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v)})},
    UrlFetchApp:{fetch:(url,options)=>{fetches.push(url);const entry=sandbox.responses.find(e=>url.includes(e.match));return {getResponseCode:()=>entry?.status??200,getContentText:()=>entry?.text??JSON.stringify(entry?.body??{}),getAllHeaders:()=>entry?.headers??{}};}},
    responses:[]
  };
  vm.createContext(sandbox);vm.runInContext(source,sandbox,{filename:'Code.gs'});
  return {api:sandbox,calls,fetches,setup:()=>sandbox.setupBookApp(),table:()=>structuredClone(table),store:()=>store,
    row:(r)=>structuredClone(store.get('Sheet1').rows[r-1]),
    put:(r,c,value,formula)=>{const x=cellAt(store.get('Sheet1'),r-1,c-1);x.value=value;if(formula)x.formula=formula;else delete x.formula;},
    failNextBatch:()=>{failBatch=true;},setLocked:value=>{locked=value;},setMaxRows:n=>{store.get('Sheet1').maxRows=n;},
    setBasicFilter:filter=>{store.get('Sheet1').basicFilter=structuredClone(filter);},basicFilter:()=>structuredClone(store.get('Sheet1').basicFilter)};
}
