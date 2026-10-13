import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { clearNotificationTarget, installNotificationNavigation, notificationTarget, readNotificationTarget } from "../src/notificationNavigation.js";

const origin="https://remote.example";
const source=fs.readFileSync(new URL("../public/sw.js",import.meta.url),"utf8");
function worker(options:{clients?:any[];cache?:Map<string,string>;storageFailure?:boolean;openFailure?:boolean}={}) {
  const listeners=new Map<string,Function>();
  const cache=options.cache??new Map<string,string>(), opens:string[]=[],shown:any[]=[];
  const context=vm.createContext({URL,Response,Date,Math,Promise,setTimeout:(fn:()=>void)=>setTimeout(fn,0),
    caches:{open:async()=>{if(options.storageFailure)throw new Error("storage unavailable");return {match:async(key:string)=>cache.has(key)?new Response(cache.get(key)):undefined,put:async(key:string,value:Response)=>{cache.set(key,await value.text());},delete:async(key:string)=>cache.delete(key)};}},
    self:{location:{origin},addEventListener:(type:string,fn:Function)=>listeners.set(type,fn),skipWaiting:async()=>{},registration:{showNotification:async(...args:any[])=>{shown.push(args);}},clients:{claim:async()=>{},matchAll:async()=>options.clients??[],openWindow:async(url:string)=>{opens.push(url);if(options.openFailure)throw new Error("open failed");return null;}}}
  });
  vm.runInContext(source,context);
  async function event(type:string,data:any) {let pending=Promise.resolve();listeners.get(type)!({...data,waitUntil:(work:Promise<any>)=>{pending=work;}});await pending;}
  return {context,cache,opens,shown,event};
}
function client(overrides:any={}) {
  const messages:any[]=[],navigations:string[]=[];
  const c:any={url:origin+"/",frameType:"top-level",focused:true,messages,navigations,postMessage:(m:any)=>messages.push(m),focus:async()=>c,navigate:async(url:string)=>{navigations.push(url);return c;},...overrides};return c;
}
function target(id="first",chatId="chat-b") {return {id,chatId,jobId:"job-1",createdAt:Date.now(),url:origin+"/?chat="+chatId};}

const warmClient=client(), warm=worker({clients:[warmClient]});
warmClient.postMessage=(message:any)=>{warmClient.messages.push(message);void warm.event("message",{data:{type:"codex-notification-ack",id:message.target.id},source:warmClient});};
await warm.context.openNotificationTarget(target());
assert.equal(warmClient.messages[0].target.chatId,"chat-b");
assert.equal(warmClient.navigations.length,0);assert.equal(warm.opens.length,0);assert.equal(warm.cache.size,0);

// Recover cold launch at '/' after the service worker itself has restarted.
const cold=worker();await cold.context.openNotificationTarget(target());
assert.equal(cold.opens[0],origin+"/?chat=chat-b");
const restarted=worker({cache:cold.cache}), readyClient=client();
await restarted.event("message",{data:{type:"codex-notification-ready"},source:readyClient});
assert.equal(readyClient.messages[0].target.chatId,"chat-b");
await restarted.event("message",{data:{type:"codex-notification-ack",id:"first"},source:readyClient});assert.equal(cold.cache.size,0);

const brokenClient=client({navigate:async()=>{throw new Error("navigate failed");}}), broken=worker({clients:[brokenClient]});
await broken.context.openNotificationTarget(target());assert.equal(broken.opens.length,1);
const noFocus=worker({clients:[client({focus:async()=>{throw new Error("focus failed");}})],openFailure:true});
await noFocus.context.openNotificationTarget(target());assert.equal(noFocus.cache.size,1);

// Control Room squares and other origins retain their state.
const square=client({url:origin+"/?control-room-tile=1",frameType:"nested"});
const unrelated=worker({clients:[square,client({url:"https://other.example/"}),client({url:origin+"/control-room"})]});
await unrelated.context.openNotificationTarget(target());assert.equal(square.messages.length,0);assert.equal(unrelated.opens.length,1);
assert.equal(unrelated.context.notificationTarget({url:"https://other.example/?chat=bad",chatId:"good"}).url,origin+"/?chat=good");
assert.equal(unrelated.context.notificationTarget({url:"/?chat=legacy"}).chatId,"legacy");

const races=worker();await races.context.saveNavigation(target("older"));await races.context.saveNavigation(target("newer","chat-c"));await races.context.acknowledgeNavigation("older");
assert.equal((await races.context.storedNavigation()).id,"newer");
const untapped=worker();await untapped.event("push",{data:{json:()=>({chatId:"untapped",body:"Example"})}});assert.equal(untapped.cache.size,0);
const volatile=worker({storageFailure:true});await volatile.context.saveNavigation(target());assert.equal((await volatile.context.storedNavigation()).chatId,"chat-b");
const expired=worker();await expired.context.saveNavigation({...target(),createdAt:Date.now()-16*60*1000});assert.equal(await expired.context.storedNavigation(),null);
assert.equal(notificationTarget({...target(),createdAt:Date.now()-16*60*1000}),null);

// Frontend: preserve intent through auth, foregrounding, duplicate messages and cleanup.
const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
const sw=new EventTarget() as any, root=new EventTarget() as any, document=new EventTarget() as any;
const requested:any[]=[],acks:any[]=[],selected:string[]=[];
sw.controller={postMessage:(message:any)=>requested.push(message)};root.location={origin};root.document=document;document.visibilityState="visible";
const dispose=installNotificationNavigation({serviceWorker:sw,root,storage,onTarget:value=>selected.push(value.chatId)});
const emit=(data:any,eventOrigin=origin)=>{const event=new Event("message");Object.assign(event,{data,origin:eventOrigin,source:{postMessage:(m:any)=>acks.push(m)}});sw.dispatchEvent(event);};
emit({type:"codex-open-chat",target:target()});
assert.deepEqual(selected,["chat-b"]);assert.equal(readNotificationTarget(storage)?.chatId,"chat-b");assert.equal(acks[0].id,"first");
emit({type:"codex-open-chat",target:target()});assert.equal(selected.length,1);
const next={...target("next","chat-c"),createdAt:Date.now()+1};emit({type:"codex-open-chat",target:next});clearNotificationTarget(storage,"chat-c");
emit({type:"codex-open-chat",target:{...target("old","chat-a"),createdAt:next.createdAt-5}});assert.equal(selected.at(-1),"chat-c");
emit({type:"codex-open-chat",target:target("bad","other")},"https://other.example");assert.equal(selected.length,2);
root.dispatchEvent(new Event("pageshow"));document.dispatchEvent(new Event("visibilitychange"));sw.dispatchEvent(new Event("controllerchange"));assert.ok(requested.length>=4);
dispose();emit({type:"codex-open-chat",target:target("disposed")});assert.equal(selected.length,2);
console.log("Notification navigation: warm/cold launch, persisted clicks, WebKit failures, races, auth-ready delivery, and Control Room isolation passed.");
