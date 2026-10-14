import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { finished } from "node:stream/promises";
import { ParsedFileCache } from "../server/parsedFileCache.js";
import { DiagnosticLog, compactDiagnosticRecord } from "../server/diagnosticLog.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseSessionFile, sessionParseCacheStats, clearSessionCache } from "../server/codexSessions.js";
const cache=new ParsedFileCache<string>(2,32);
let loads=0;
const load=async()=>{loads++;await new Promise(r=>setTimeout(r,5));return "parsed";};
assert.deepEqual(await Promise.all([cache.get("file","v1",load),cache.get("file","v1",load)]),["parsed","parsed"]);
assert.equal(loads,1,"Concurrent reads must coalesce");
await cache.get("file","v2",load);assert.equal(loads,2,"Append/rewrite/index signatures invalidate cache");
await cache.get("other","v1",load);await cache.get("third","v1",load);
await cache.get("file","v2",load);assert.equal(loads,5,"LRU limits must evict old entries");
const base=await fs.mkdtemp(path.join(os.tmpdir(),"remote-storage-check-"));
try{
 const id="00000000-0000-0000-0000-000000000001",transcript=path.join(base,`rollout-${id}.jsonl`);
 const timestamp="2026-10-14T12:00:00Z";
 const rows=[{timestamp,type:"session_meta",payload:{id,cwd:base,timestamp}},
  {timestamp,type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"one"}]}},
  {timestamp,type:"response_item",payload:{type:"message",role:"assistant",phase:"final_answer",content:[{type:"output_text",text:"response"}]}}];
 await fs.writeFile(transcript,rows.map(r=>JSON.stringify(r)).join("\n")+"\n");
 const index=new Map([[id,{threadName:"First title",updatedAt:timestamp}]]);
 const first=await parseSessionFile(transcript,index);assert.ok(first);
 first.title="mutated";clearSessionCache();
 const before=sessionParseCacheStats();const second=await parseSessionFile(transcript,index);
 assert.equal(second?.title,"First title");assert.equal(sessionParseCacheStats().hits,before.hits+1);
 index.set(id,{threadName:"Renamed title",updatedAt:timestamp});
 assert.equal((await parseSessionFile(transcript,index))?.title,"Renamed title","Rename metadata must invalidate cache");
 await fs.appendFile(transcript,JSON.stringify({timestamp,type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"two"}]}})+"\n");
 assert.equal((await parseSessionFile(transcript,index))?.lastPrompt?.text,"two","Append must invalidate cache without losing new prompts");
 console.log("PASS: real parser heartbeat reuse, mutation isolation, rename invalidation and appended messages.");
 const file=path.join(base,"stdout.log");const stream=new DiagnosticLog(file,1024);
 for(let i=0;i<100;i++)stream.write(compactDiagnosticRecord(JSON.stringify({method:"item/completed",params:{item:{text:"x".repeat(100000)}}})));
 stream.terminal({type:"turn.completed"});stream.end();await finished(stream);
 const bytes=await fs.readFile(file);
 assert.ok(bytes.length<1600,"Diagnostic output must stay bounded");
 const records=bytes.toString().trim().split("\n").map(line=>JSON.parse(line));
 assert.equal(records.at(-1).type,"turn.completed","Terminal recovery marker must survive the limit and remain last");
 assert.equal(records.filter(r=>r.type==="diagnostic_limit").length,1);
 await fs.mkdir(path.join(base,"logs/codex-runs"),{recursive:true});
 await fs.mkdir(path.join(base,".runtime"));
 const logs=path.join(base,"logs/codex-runs");
 for(const name of ["complete","pinned","failed","unknown"]){
  const type=name==="complete"||name==="pinned"?"turn.completed":name==="failed"?"turn.failed":"unknown";
  for(const ext of ["stdout.log","stderr.log","last-message.txt"]){
   const p=path.join(logs,`${name}.${ext}`);await fs.writeFile(p,ext==="stdout.log"?JSON.stringify({type})+"\n":"retained data");
   await fs.utimes(p,new Date(0),new Date(0));
  }
 }
 await fs.writeFile(path.join(base,".runtime/codex-runner-state.json"),JSON.stringify({pending:[{job:{logPaths:{stdout:path.join(logs,"pinned.stdout.log")}}}]}));
 const retention=fileURLToPath(new URL("./retain-run-diagnostics.mjs",import.meta.url));
 const preview=spawnSync(process.execPath,[retention],{cwd:base,encoding:"utf8"});assert.equal(preview.status,0,preview.stderr);
 assert.equal(JSON.parse(preview.stdout).eligibleCompletedRuns,1);
 await fs.access(path.join(logs,"complete.stdout.log"));
 const applied=spawnSync(process.execPath,[retention,"--apply"],{cwd:base,encoding:"utf8"});assert.equal(applied.status,0,applied.stderr);
 assert.equal(JSON.parse(applied.stdout).removedFiles,2);
 for(const name of ["pinned.stdout.log","failed.stdout.log","unknown.stdout.log","complete.last-message.txt"])await fs.access(path.join(logs,name));
 console.log("PASS: manual retention preview, completed-only eligibility, pending-job protection, failed evidence and final-message preservation.");
 console.log(`PASS: coalescing, invalidation, LRU; 10 MB duplicate payload bounded to ${bytes.length} bytes with terminal recovery retained.`);
}finally{await fs.rm(base,{recursive:true,force:true});}
