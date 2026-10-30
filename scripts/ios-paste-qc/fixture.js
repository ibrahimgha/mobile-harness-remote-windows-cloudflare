// Isolated real-frontend fixture. No real credentials, workers or Remote API.
localStorage.clear();
localStorage.setItem('control-token','isolated-paste-qc');
const at='2026-10-30T12:00:00Z';
const summary={id:'paste-fixture',title:'Paste QC',projectName:'Paste QC only',projectPath:'/qc-only',createdAt:at,updatedAt:at,hasResponse:true};
const messages=[{id:'p',role:'user',kind:'user_prompt',text:'QC fixture only',createdAt:at},{id:'a',role:'assistant',kind:'assistant_final',isFinal:true,text:'Paste test ready',createdAt:at}];
const settings={model:'gpt-6.1-sol',reasoningEffort:'medium',speed:'default',updatedAt:at};
const state={access:{mode:'full'},bridge:{mode:'simulation',targetTitle:'QC',controlEnabled:false,platform:'win32'},server:{name:'ISOLATED PASTE QC',uptimeSeconds:1},runner:{mode:'simulation',settings,settingsOptions:{models:[settings.model],reasoningEfforts:['medium'],speeds:['default']},activeJobs:0,queuedJobs:0,recentJobs:[],usage:null},recentEvents:[]};
const nativeFetch=window.fetch.bind(window);
window.fetch=async(input,options)=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(!url.pathname.startsWith('/api/'))return nativeFetch(input,options);
 let body={ok:true};
 if(url.pathname==='/api/state'||url.pathname==='/api/auth/verify')body=url.pathname.includes('/auth/')?{ok:true,state}:state;
 else if(url.pathname==='/api/chats')body={projects:[{projectName:summary.projectName,projectPath:summary.projectPath,chats:[summary]}],totalChats:1};
 else if(url.pathname==='/api/chats/paste-fixture')body={...summary,messages,lastPrompt:messages[0],lastResponse:messages[1],messagePage:{hasMore:false,visibleTurns:1,totalTurns:1}};
 else if(url.pathname.endsWith('/jobs'))body={jobs:[],activeJobs:0,queuedJobs:0};
 else if(url.pathname==='/api/chats/activity')body={activeRuns:[]};
 if((options?.method||'GET')==='POST'&&!url.pathname.includes('/auth/'))throw Error('QC forbids real prompt submission');
 return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
};
window.WebSocket=class extends EventTarget {static OPEN=1;readyState=1;send(){}close(){this.readyState=3;}};
addEventListener('DOMContentLoaded',()=>{
 const paste=document.createElement('button');paste.textContent='QC clipboard paste';paste.style='position:fixed;top:22px;left:0;z-index:99999';
 paste.onpointerdown=e=>e.preventDefault();paste.onclick=()=>{const editor=document.querySelector('.composer-editor');const data=new DataTransfer();data.setData('text/plain','PASTED\nsecond line');editor.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));};document.body.append(paste);
 const status=document.createElement('div');status.id='paste-qc-status';status.style='position:fixed;top:0;left:0;z-index:99999;background:#111;color:#fff;font-size:12px;pointer-events:none';document.body.append(status);
 let previous='';
 setInterval(()=>{
  const e=document.querySelector('.composer-editor');
  const value=e?.textContent||'';
  const expected='Previously written half prompt\n\nPASTED\nsecond line';
  status.textContent=value===expected?'PASTE_QC_SUCCESS':'PASTE_QC_READY';
  const snapshot=JSON.stringify({value,html:e?.innerHTML,draft:localStorage.getItem('codex-remote-chat-draft-v1:paste-fixture'),success:value===expected});
  if(snapshot!==previous){previous=snapshot;void nativeFetch('/qc',{method:'POST',body:snapshot});}
 },100);
});
