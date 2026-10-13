#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

export async function run(argv, {fetcher=fetch, env=process.env}={}) {
  const [command,...rest]=argv, flags={};
  for(let i=0;i<rest.length;i+=2) {
    if(!rest[i]?.startsWith('--') || rest[i+1]===undefined) throw new Error('Options use --name value');
    flags[rest[i].slice(2)]=rest[i+1];
  }
  const connectionPath=flags.connection || env.CODEX_REMOTE_CONNECTION_FILE || fileURLToPath(new URL('../connection.json',import.meta.url));
  const connection=JSON.parse(fs.readFileSync(connectionPath,'utf8'));
  const base=new URL(connection.baseUrl);
  if(!['http:','https:'].includes(base.protocol) || base.username || base.password) throw new Error('Configure an HTTP(S) base URL and a separate credential file');
  const require=createRequire(path.join(connection.projectRoot,'package.json'));
  const dotenv=require('dotenv');
  const credentialEnv=dotenv.parse(fs.readFileSync(connection.envFile));
  const token=credentialEnv.CONTROL_TOKEN?.trim();
  if(!token) throw new Error('CONTROL_TOKEN is missing from the configured credential file');
  const redact=value=>String(value).split(token).join('[redacted]');
  const chatLink=id=>{
    if(!id || !connection.publicUrl) return undefined;
    const target=new URL(`/?chat=${encodeURIComponent(id)}`,connection.publicUrl);
    target.username='';target.password='';
    return target.href;
  };
  async function api(route,body,method=body?'POST':'GET') {
    let response;
    try {
      response=await fetcher(new URL(route,base),{method,headers:{'x-control-token':token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000),redirect:'error'});
    } catch(error) { throw new Error(`Request outcome requires reconciliation: ${redact(error.message)}${flags['request-id']?`; request ID ${flags['request-id']}`:''}`); }
    let result;
    try { result=await response.json(); } catch { throw new Error(`Remote returned HTTP ${response.status}; check its connection`); }
    if(!response.ok) throw new Error(`Remote HTTP ${response.status}: ${redact(result.message || 'Request rejected')}`);
    return result;
  }
  const required=name=>{if(!flags[name]) throw new Error(`--${name} is required`);return flags[name];};
  const jobSummary=job=>job ? {id:job.id,chatId:job.chatId,status:job.status,message:job.message,settings:job.settings,inputSource:job.inputSource,startedAt:job.startedAt,finishedAt:job.finishedAt,heartbeat:job.heartbeat,chatUrl:chatLink(job.chatId)} : undefined;
  let result;
  if(command==='state') {
    const state=await api('/api/state');
    result={machine:state.server?.name,mode:state.runner?.mode,skill:state.runner?.skill,settings:state.runner?.settings,settingsOptions:state.runner?.settingsOptions,activeJobs:state.runner?.activeJobs,queuedJobs:state.runner?.queuedJobs};
  } else if(command==='chats') {
    const index=await api('/api/chats'), query=(flags.query||'').toLowerCase();
    result={machine:connection.machine,projects:(index.projects||[]).map(project=>({name:project.projectName,path:project.projectPath,chats:(project.chats||[]).filter(chat=>JSON.stringify([project.projectName,project.projectPath,chat.title,chat.id]).toLowerCase().includes(query)).map(chat=>({id:chat.id,title:chat.title,updatedAt:chat.updatedAt,chatUrl:chatLink(chat.id)}))})).filter(project=>project.chats.length)};
  } else if(command==='prompt') {
    const chat=required('chat'), requestId=required('request-id');
    const text=fs.readFileSync(required('text-file'),'utf8');
    const settings={...(flags.model?{model:flags.model}:{}),...(flags.reasoning?{reasoningEffort:flags.reasoning}:{}),...(flags.speed?{speed:flags.speed}:{})};
    const response=await api(`/api/chats/${encodeURIComponent(chat)}/prompt`,{text,clientRequestId:requestId,inputSource:flags.source||'typed',...(Object.keys(settings).length?{settings}:{})});
    result={machine:connection.machine,requestId,disposition:response.disposition,job:jobSummary(response.job),chatUrl:chatLink(chat)};
  } else if(command==='status') {
    const response=await api(`/api/chats/${encodeURIComponent(required('chat'))}/jobs`);
    result={jobs:(response.jobs||[]).filter(job=>!flags.job||job.id===flags.job).map(jobSummary)};
  } else if(command==='read') {
    const chat=required('chat');
    result=await api(`/api/chats/${encodeURIComponent(chat)}?mode=final&turns=${encodeURIComponent(flags.turns||'10')}`);
  } else if(command==='steer'||command==='stop') {
    const chat=required('chat'), job=required('job');
    const route=command==='steer'?`queued-prompts/${encodeURIComponent(job)}/steer`:`jobs/${encodeURIComponent(job)}/stop`;
    const response=await api(`/api/chats/${encodeURIComponent(chat)}/${route}`,{});
    result={message:response.message,job:jobSummary(response.job),chatUrl:chatLink(chat)};
  } else if(command==='create') {
    result=await api('/api/chats',{projectPath:required('project'),title:required('title')});
  } else if(command==='creation') {
    const response=await api(`/api/chat-starts/${encodeURIComponent(required('id'))}`);
    result={pendingId:response.pendingId,status:response.status,message:response.message,chat:response.chat?{id:response.chat.id,title:response.chat.title,chatUrl:chatLink(response.chat.id)}:undefined};
  } else throw new Error('Commands: state, chats, prompt, status, read, steer, stop, create, creation');
  return JSON.parse(redact(JSON.stringify(result)));
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
