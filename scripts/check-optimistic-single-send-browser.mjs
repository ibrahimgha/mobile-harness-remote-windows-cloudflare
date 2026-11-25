import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium,webkit}=require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const tempBase=fs.existsSync('D:/')?'D:/CodexTemp':os.tmpdir();
fs.mkdirSync(tempBase,{recursive:true});
const scratch=fs.mkdtempSync(path.join(tempBase,'codex-single-send-'));
const server=await createServer({configFile:false,cacheDir:path.join(scratch,'vite'),plugins:[react()],optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react-markdown','remark-gfm','rehype-raw','rehype-sanitize','lucide-react'],entries:['index.html']},server:{host:'127.0.0.1',port:0,watch:null},logLevel:'error'});
let browser;
try {
  await server.listen();
  browser=await (process.argv.includes('--webkit')?webkit:chromium).launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.setItem('control-token','isolated-fixture-token');
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends EventTarget {
      static OPEN=1;static CLOSED=3;readyState=1;
      constructor(url,protocols){super();if(new URL(String(url),location.href).pathname!=='/ws')return new NativeWebSocket(url,protocols);}
      send(){}close(){this.readyState=3;}
    };
  });
  const at=new Date(Date.now()-3600_000).toISOString();
  const summary={id:'single-send',title:'Single-send regression',projectName:'Isolated test',projectPath:'/test-only',createdAt:at,updatedAt:at,hasResponse:true};
  const settings={model:'gpt-6.2-sol',reasoningEffort:'medium',speed:'default',updatedAt:at};
  const messages=[
    {id:'old-prompt',role:'user',kind:'user_prompt',text:'Earlier task',createdAt:at},
    {id:'old-reply',role:'assistant',kind:'assistant_final',isFinal:true,text:Array.from({length:12},(_,i)=>`Earlier response paragraph ${i+1}. This belongs to the previous completed task.`).join('\n\n'),createdAt:at}
  ];
  let submittedJob=null, posts=0, historyReads=0;
  const prompt='One new message. Keep this bubble visible while I touch nothing.';
  await page.route('**/api/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    let body={ok:true};
    if(pathname.endsWith('/prompt')&&route.request().method()==='POST'){
      posts++;
      const request=route.request().postDataJSON();
      assert.equal(request.text,prompt);
      const now=new Date().toISOString();
      submittedJob={id:'single-job',clientRequestId:request.clientRequestId,chatId:summary.id,projectPath:summary.projectPath,status:'running',createdAt:now,startedAt:now,promptPreview:request.text,settings};
      await new Promise(resolve=>setTimeout(resolve,600));
      body={ok:true,disposition:'started',job:submittedJob};
    }
    else if(pathname==='/api/state')body={access:{mode:'full'},bridge:{mode:'simulation',targetTitle:'Fixture',controlEnabled:false,platform:'win32'},server:{name:'QC ONLY',uptimeSeconds:1},runner:{mode:'simulation',settings,settingsOptions:{models:['gpt-6-luna','gpt-6.2-sol','gpt-6.2-astra'],reasoningEfforts:['low','medium','max'],speeds:['default']},activeJobs:submittedJob?1:0,queuedJobs:0,recentJobs:submittedJob?[submittedJob]:[],usage:null}};
    else if(pathname==='/api/chats')body={projects:[{projectName:summary.projectName,projectPath:summary.projectPath,chats:[summary]}],activeRuns:[]};
    else if(pathname.endsWith('/jobs'))body={jobs:submittedJob?[submittedJob]:[],activeJobs:submittedJob?1:0,queuedJobs:0};
    else if(pathname==='/api/chats/single-send'){
      historyReads++;
      body={...summary,messages,lastPrompt:messages[0],lastResponse:messages[1],messagePage:{hasMore:false,visibleTurns:1,totalTurns:1}};
    }
    else if(pathname==='/api/chats/activity')body={runs:[]};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?chat=single-send`,{waitUntil:'domcontentloaded'});
  await page.getByText('Earlier response paragraph 12.',{exact:false}).waitFor();
  assert.equal(await page.locator('.composer-power-model').textContent(),'Sol 6.2 Medium');
  await page.getByRole('textbox',{name:'New prompt'}).fill(prompt);
  await page.getByRole('button',{name:'Send prompt',exact:true}).click();
  await page.locator('.chat-content').getByText(prompt,{exact:true}).waitFor();
  await page.evaluate(text=>{
    window.singleSendSamples=[];
    const sample=()=>{
      const scroller=document.querySelector('.chat-content');
      const paragraphs=[...scroller.querySelectorAll('article p')];
      const element=paragraphs.find(p=>p.textContent===text);
      const rect=element?.getBoundingClientRect(),viewport=scroller.getBoundingClientRect();
      const old=paragraphs.findIndex(p=>p.textContent.startsWith('Earlier response paragraph 12.'));
      window.singleSendSamples.push({count:paragraphs.filter(p=>p.textContent===text).length,afterHistory:paragraphs.indexOf(element)>old,inViewport:!!rect&&rect.bottom>viewport.top&&rect.top<viewport.bottom,scrollTop:scroller.scrollTop,position:paragraphs.indexOf(element),renderKey:element?.closest('article').dataset.renderKey});
    };
    window.singleSendTimer=setInterval(sample,100);
  },prompt);
  const beforeReads=historyReads;
  // Deliberately no more user input, refresh, reload or navigation. The normal
  // 4/5-second background polls must retain both the bubble AND its position.
  await page.waitForTimeout(12000);
  // Even completion can arrive before the transcript reader catches up.
  submittedJob={...submittedJob,status:'completed',finishedAt:new Date().toISOString()};
  await page.waitForTimeout(6000);
  const echoAt=new Date().toISOString();
  messages.push({id:'authoritative-echo',role:'user',kind:'user_prompt',text:prompt,createdAt:echoAt});
  messages.push({id:'authoritative-answer',role:'assistant',kind:'assistant_final',isFinal:true,text:'Answer to the single message.',createdAt:echoAt});
  await page.locator('.chat-content').getByText('Answer to the single message.',{exact:true}).waitFor();
  await page.waitForTimeout(1000);
  const samples=await page.evaluate(()=>{clearInterval(window.singleSendTimer);return window.singleSendSamples;});
  assert.equal(posts,1);
  assert.ok(historyReads>beforeReads+1,'multiple real background history polls completed');
  console.log(JSON.stringify({historyReads,samples:samples.filter((s,i)=>!i||JSON.stringify(s)!==JSON.stringify(samples[i-1]))}));
  assert.ok(samples.every(s=>s.count===1),'one bubble remains in the DOM after a single send');
  assert.ok(samples.every(s=>s.afterHistory),'single-send bubble must never move above older messages during idle polling');
  assert.ok(samples.slice(5).every(s=>s.inViewport),'single-send bubble stays in view once initial scrolling settles');
  assert.equal(new Set(samples.map(s=>s.renderKey)).size,1,'the real transcript echo must not remount the bubble');
  assert.deepEqual(errors,[]);
  console.log('PASS: one send, no further interaction; idle polls, completion before echo, and final transcript retain one bubble in place and in view.');
} finally {
  await browser?.close();await server.close();
  const resolved=path.resolve(scratch);
  assert.ok(resolved.startsWith(path.resolve(tempBase)+path.sep+'codex-single-send-'));
  fs.rmSync(resolved,{recursive:true,force:true});
}
