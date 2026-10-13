import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import WebSocket from 'ws';
console.log('Starting isolated confirmation browser fixture');
const server=await createServer({configFile:false,plugins:[react()],optimizeDeps:{noDiscovery:true,include:['react','react-dom/client'],entries:['.runtime/confirmation-browser/index.html']},logLevel:'error',server:{host:'127.0.0.1',port:0,watch:null}});
await server.listen();
console.log('Fixture server listening');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'codex-confirmation-browser-'));
const chrome=spawn('C:/Users/ibrah/AppData/Local/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-extensions','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let ws,page,id=0;const pending=new Map();
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>reject(Error('Timeout: '+method)),20000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:key,method,params,sessionId}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},page);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await wait(100);}throw Error('Browser check timed out');}
async function click(selector){const box=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...box,button:'left',clickCount:1},page);await send('Input.dispatchMouseEvent',{type:'mouseReleased',...box,button:'left',clickCount:1},page);}
try{
 await until(()=>fs.existsSync(path.join(profile,'DevToolsActivePort')));
 console.log('Headless browser ready');
 const [port,endpoint]=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);
 ws=new WebSocket('ws://127.0.0.1:'+port+endpoint);await new Promise(r=>ws.once('open',r));
 ws.on('message',raw=>{const m=JSON.parse(String(raw));if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const {targetInfos}=await send('Target.getTargets');const targetId=targetInfos.find(t=>t.type==='page').targetId;({sessionId:page}=await send('Target.attachToTarget',{targetId,flatten:true}));
 await send('Page.enable',{},page);await send('Runtime.enable',{},page);
 console.log('Browser page attached');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},page);
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.httpServer.address().port+'/.runtime/confirmation-browser/index.html'},page);
 await until(()=>evaluate("!!document.querySelector('.confirmation-actions button')"));
 for(const width of [360,390,800]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<500},page);
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
  const layers=await evaluate(`(()=>{const row=document.querySelector('.confirmation-suggestions');const composer=document.querySelector('.composer');const secondary=document.querySelector('.confirmation-actions button + button');return {position:getComputedStyle(row).position,z:getComputedStyle(row).zIndex,fadeZ:getComputedStyle(composer,'::before').zIndex,background:getComputedStyle(secondary).backgroundColor};})()`);
  assert.equal(layers.position,'relative');
  assert.ok(Number(layers.z)>(layers.fadeZ==='auto'?0:Number(layers.fadeZ)), 'Confirmation controls must paint above the composer fade');
  assert.equal(layers.background,'rgb(237, 241, 237)', 'Secondary button must have an opaque background');
 }
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},page);
 await evaluate("document.querySelector('#history').scrollTop=200;true");
 const before=await evaluate("document.querySelector('#history').scrollTop");
 await click('.confirmation-actions button + button');
 assert.equal(await evaluate("document.activeElement.getAttribute('role')"),'textbox');
 assert.equal(await evaluate("document.querySelector('[role=textbox]').textContent"),'Existing draft');
 assert.equal(await evaluate('window.accepts'),0);assert.equal(await evaluate('window.dismisses'),1);
 assert.equal(await evaluate("document.querySelector('#history').scrollTop"),before);
 const loaded=new Promise(resolve=>{const listener=raw=>{const event=JSON.parse(String(raw));if(event.method==='Page.loadEventFired'&&event.sessionId===page){ws.off('message',listener);resolve();}};ws.on('message',listener);});
 await send('Page.reload',{},page);await loaded;await until(()=>evaluate("typeof window.next==='function' && !!document.querySelector('[role=textbox]')"));
 assert.equal(await evaluate("!!document.querySelector('.confirmation-actions')"),false);
 await evaluate('window.next()');await until(()=>evaluate("!!document.querySelector('.confirmation-actions')"));
 await click('.confirmation-actions button');await click('.confirmation-actions button');
 await until(()=>evaluate("!document.querySelector('.confirmation-actions')"));
 assert.equal(await evaluate('window.accepts'),1);
 assert.equal(await evaluate("document.querySelector('[role=textbox]').textContent"),'Existing draft');
 assert.deepEqual(await evaluate('window.files'),['screenshot.png']);
 console.log('PASS: 360/390/800px layout, trusted-click composer focus, history position, persisted dismissal, single submission and retained draft/files. Chromium mobile emulation; physical iOS keyboard not emulated.');
}finally{if(ws?.readyState===1){await send('Browser.close');ws.close();}await server.close();chrome.kill();}
