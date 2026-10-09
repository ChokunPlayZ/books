import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function scannerHarness(extra={}) {
  const html=readFileSync(new URL('../apps-script/Index.html',import.meta.url),'utf8');
  const source=html.slice(html.indexOf('    // Match the server'),html.indexOf("    $('addButton').addEventListener"));
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{open:true,hidden:false,disabled:false,textContent:'',replaceChildren(){},querySelector(){return null;}});return elements.get(id);};
  const state={scanGeneration:0,cameraStart:null,cameraRunning:false,cameraStream:null,cameraTimer:null,photoTask:null};
  const context=vm.createContext({state,$:element,DOMException,Promise,Map,Set,setTimeout,clearTimeout,navigator:{},...extra});
  vm.runInContext(source,context);
  return {context,state,element,run:code=>vm.runInContext(code,context)};
}

test('printed ISBN recognition handles photo punctuation and rejects shop codes and bad checksums',()=>{
  const h=scannerHarness();
  assert.equal(h.run("printedIsbns('ISBN 978–616—614—735-3').join()"),'9786166147353');
  assert.equal(h.run("printedIsbns('978-616—-614—-735-3').join()"),'9786166147353');
  h.context.text='ISBN 978-616-489-468-6\n9786164894686';assert.equal(h.run('printedIsbns(text).join()'),'9786164894686');
  assert.equal(h.run("printedIsbns('ISBN-10: 0-8044-2957-X').join()"),'9780804429573');
  for(const text of ['3032504880045','9786166147354','97861648946860','19786164894686','978-616-\n614-735-3','ISBN 978-O16-489-468-6']){
    h.context.text=text;assert.equal(h.run('printedIsbns(text).length'),0,text);
  }
});

test('closing scanner stops camera tracks and cancels photo work without waiting for permission',()=>{
  const h=scannerHarness();let stopped=0,cancelled=0,terminated=0;
  h.state.cameraStart=new Promise(()=>{});h.state.cameraRunning=true;
  h.state.cameraStream={getTracks:()=>[{stop(){stopped++;}}]};
  h.state.photoTask={cancel(){cancelled++;},worker:{terminate(){terminated++;return Promise.resolve();}}};
  h.run('stopScanner()');
  assert.equal(stopped,1);assert.equal(cancelled,1);assert.equal(terminated,1);
  assert.equal(h.state.cameraStart,null);assert.equal(h.state.cameraRunning,false);assert.equal(h.state.photoTask,null);
  assert.equal(h.state.scanGeneration,1);assert.equal(h.element('startCamera').disabled,false);
});

test('permission denial and a synchronous camera error leave photo controls available',async()=>{
  for(const synchronous of [false,true]){
    const error=new DOMException('Denied','NotAllowedError');
    const h=scannerHarness({navigator:{mediaDevices:{getUserMedia(){if(synchronous)throw error;return Promise.reject(error);}}}});
    await h.run('startCamera()');
    assert.match(h.element('scanMessage').textContent,/blocked.*Take photo/);
    assert.equal(h.element('startCamera').disabled,false);assert.equal(h.state.cameraRunning,false);
  }
});

test('permission granted after scanner closes cannot restart the camera',async()=>{
  let allow,stopped=0;
  const h=scannerHarness({navigator:{mediaDevices:{getUserMedia:()=>new Promise(resolve=>{allow=resolve;})}}});
  const starting=h.run('startCamera()');h.run('stopScanner()');h.element('scanDialog').open=false;
  allow({getTracks:()=>[{stop(){stopped++;}}]});await starting;
  assert.equal(stopped,1);assert.equal(h.state.cameraRunning,false);assert.equal(h.state.cameraStream,null);
});

test('cancelling a text scan releases an unresponsive OCR job',async()=>{
  let recognizeStarted,terminated=0;
  const started=new Promise(resolve=>{recognizeStarted=resolve;});
  const worker={setParameters:async()=>{},recognize(){recognizeStarted();return new Promise(()=>{});},terminate:async()=>{terminated++;}};
  const h=scannerHarness({Tesseract:{PSM:{SPARSE_TEXT:11},createWorker:async()=>worker}});
  h.run('var task={worker:null};task.cancelled=new Promise(resolve=>task.cancel=resolve);state.photoTask=task;');
  const reading=h.run('readPrintedIsbns({},0,task)');await started;h.run('stopScanner()');
  await assert.rejects(reading,error=>error.name==='AbortError');assert.equal(terminated,1);
});
