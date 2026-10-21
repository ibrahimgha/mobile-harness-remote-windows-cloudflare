import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const tempBase=fs.existsSync('D:/')?'D:/CodexTemp':os.tmpdir();
fs.mkdirSync(tempBase,{recursive:true});
const scratch=fs.mkdtempSync(path.join(tempBase,'codex-run-status-'));
const server=await createServer({configFile:false,cacheDir:path.join(scratch,'vite'),plugins:[react()],optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react-markdown','remark-gfm','rehype-raw','rehype-sanitize','lucide-react'],entries:['index.html']},server:{host:'127.0.0.1',port:0,watch:null},logLevel:'error'});
await server.listen();
console.log('Isolated App server ready');
let browser;
try {
 browser=await chromium.launch({headless:true});
 console.log('Isolated browser ready');
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',error=>console.log('Fixture page error:',error.message));
 await page.addInitScript(()=>{
  localStorage.setItem('control-token','isolated-fixture-token');
  const NativeWebSocket=window.WebSocket;
  window.WebSocket=class extends EventTarget {
   static OPEN=1;static CLOSED=3;readyState=1;
   constructor(url,protocols){super();if(new URL(String(url),location.href).pathname!=='/ws')return new NativeWebSocket(url,protocols);}
   send(){}close(){this.readyState=3;}
  };
 });
 const at=(minute)=>`2026-10-14T08:${minute}:00.000Z`;
 const summary={id:'status-fixture',title:'Stop timeline QC',projectName:'Isolated test',projectPath:'/test-only',createdAt:at('13'),updatedAt:at('17'),hasResponse:true};
 const settings={model:'gpt-6.1-sol',reasoningEffort:'medium',speed:'default',updatedAt:at('13')};
 const job={id:'old-stop',chatId:summary.id,projectPath:summary.projectPath,status:'stopped',createdAt:at('13'),finishedAt:at('14'),message:'Stopped from the remote for this chat',promptPreview:'old task',settings,textLength:8,command:[],logPaths:{}};
 let capacityRetry=null;
 const jobs=()=>capacityRetry?[capacityRetry,job]:[job];
 const messages=[
  {id:'old-prompt',role:'user',kind:'user_prompt',text:'Old task',createdAt:at('13')},
  {id:'new-prompt',role:'user',kind:'user_prompt',text:'New task after stopping',createdAt:at('15')},
  {id:'reply-15',role:'assistant',kind:'assistant_final',isFinal:true,text:'Newer reply',createdAt:at('15')},
  {id:'reply-17',role:'assistant',kind:'assistant_final',isFinal:true,text:'Newest reply',createdAt:at('17')}
 ];
 messages.push({id:'injected-policy',role:'user',kind:'user_prompt',text:'# AGENTS.md instructions for C:\\fixture\nInjected policy fixture',createdAt:at('18')});
 await page.route('**/api/**',route=>{
  const pathname=new URL(route.request().url()).pathname;
  let body={ok:true};
  if(pathname==='/api/state')body={access:{mode:'full'},bridge:{mode:'simulation',targetTitle:'Fixture',controlEnabled:false,platform:'win32'},server:{name:'QC ONLY',uptimeSeconds:1},runner:{mode:'simulation',settings,settingsOptions:{models:['gpt-6.1-sol'],reasoningEfforts:['medium'],speeds:['default']},activeJobs:0,queuedJobs:capacityRetry?1:0,recentJobs:jobs(),usage:null},recentEvents:[]};
  else if(pathname==='/api/chats')body={projects:[{projectName:summary.projectName,projectPath:summary.projectPath,chats:[summary]}],activeRuns:[]};
  else if(pathname.endsWith('/jobs'))body={jobs:jobs(),activeJobs:0,queuedJobs:capacityRetry?1:0};
  else if(pathname==='/api/chats/status-fixture')body={...summary,messages,lastPrompt:messages[1],lastResponse:messages[3],messagePage:{hasMore:false,visibleTurns:2,totalTurns:2}};
  else if(pathname==='/api/chats/activity')body={activeRuns:[]};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?chat=status-fixture`,{waitUntil:'domcontentloaded',timeout:30000});
 console.log('Navigated to mobile App');
 try { await page.getByText('Newest reply',{exact:true}).waitFor(); }
 catch(error){console.log('Fixture state:',await page.locator('body').innerText());throw error;}
 assert.equal(await page.locator('.chat-workspace').getAttribute('data-composer-overlap'),'true','real App mounts the mobile composer observer after authentication');
 assert.equal(await page.locator('.chat-content').getByText('Injected policy fixture',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await page.getByText('Appearance',{exact:true}).click();
 const showInstructions=page.getByRole('checkbox',{name:'Show injected instructions',exact:true});
 assert.equal(await showInstructions.isChecked(),false);
 await showInstructions.check();
 await page.getByRole('button',{name:'Close menu',exact:true}).click();
 await page.locator('.chat-content').getByText('Injected policy fixture',{exact:true}).waitFor();
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('.chat-content').getByText('Injected policy fixture',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await page.getByText('Appearance',{exact:true}).click();
 assert.equal(await showInstructions.isChecked(),true);
 await showInstructions.uncheck();
 await page.getByRole('button',{name:'Close menu',exact:true}).click();
 assert.equal(await page.locator('.chat-content').getByText('Injected policy fixture',{exact:true}).count(),0);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByText('Newest reply',{exact:true}).waitFor();
 assert.equal(await page.locator('.chat-content').getByText('Injected policy fixture',{exact:true}).count(),0);
 for(let refresh=0;refresh<3;refresh++){
  const text=await page.locator('.chat-content').innerText();
  assert.ok(text.indexOf('Stopped from the remote')<text.indexOf('Newer reply'));
  assert.ok(text.indexOf('Newer reply')<text.indexOf('Newest reply'));
  assert.equal(text.split('Stopped from the remote').length-1,1);
  await page.getByRole('button',{name:'Chat actions',exact:true}).click();
  await page.getByRole('button',{name:'Refresh this chat',exact:true}).click();
  await page.getByText('Newest reply',{exact:true}).waitFor();
 }
 console.log('PASS: actual mobile App keeps stop notice before newer replies through repeated refreshes; no real jobs or credentials.');
 console.log('PASS: actual mobile App hides injected instructions by default; Appearance opt-in and opt-out survive reloads without hiding genuine prompts/replies.');
 const capacityNow=Date.parse('2026-10-19T10:55:13.900Z');
 await page.clock.install({time:new Date(capacityNow)});
 capacityRetry={...job,id:'capacity-retry',status:'queued',finishedAt:undefined,createdAt:new Date(capacityNow).toISOString(),promptPreview:'resume',capacityRetryOfJobId:'capacity-failure',notBefore:new Date(capacityNow+300000).toISOString()};
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('.command-queue .queue-actions time').waitFor();
 await page.clock.pauseAt(new Date(capacityNow+60000));
 assert.equal(await page.locator('.queue-actions time').textContent(),'Capacity retry in 4:00');
 assert.equal(await page.locator('.job-strip-label').textContent(),'Capacity retry in 4:00');
 await page.clock.runFor(2000);
 assert.equal(await page.locator('.queue-actions time').textContent(),'Capacity retry in 3:58');
 await page.clock.fastForward(300000);
 assert.equal(await page.locator('.queue-actions time').textContent(),'Capacity retry ready');
 console.log('PASS: mobile capacity queue and banner count down without an active worker and never claim a queued retry is running.');
} finally {
 await browser?.close();await server.close();
 const resolved=path.resolve(scratch);
 assert.ok(resolved.startsWith(path.resolve(tempBase)+path.sep+'codex-run-status-'));
 fs.rmSync(resolved,{recursive:true,force:true});
}
