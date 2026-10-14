// Manual-only retention. Preview by default; never delete native transcripts,
// last-message recovery data, failed/unknown runs, or pending job diagnostics.
import fs from 'node:fs';
import path from 'node:path';
const apply=process.argv.includes('--apply');
const daysArg=process.argv.find(a=>a.startsWith('--days='));
const days=Number(daysArg?.split('=')[1] ?? 30);
if(!Number.isFinite(days)||days<1)throw Error('Retention days must be at least 1');
const root=fs.realpathSync('logs/codex-runs');
// Fail closed if recovery state is unavailable or malformed.
const journal=JSON.parse(fs.readFileSync('.runtime/codex-runner-state.json','utf8'));
if(!Array.isArray(journal.pending))throw Error('Cannot establish pending-job protection');
const pinned=new Set(journal.pending.flatMap(item=>Object.values(item.job?.logPaths??{})).map(p=>path.resolve(p)));
const cutoff=Date.now()-days*86400000;
let candidates=0,bytes=0,removed=0;
for(const name of fs.readdirSync(root)){
 if(!name.endsWith('.stdout.log'))continue;
 const stdout=path.join(root,name),stat=fs.lstatSync(stdout);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.mtimeMs>=cutoff||pinned.has(stdout))continue;
 const fd=fs.openSync(stdout,'r'),buffer=Buffer.alloc(Math.min(stat.size,65536));
 try{fs.readSync(fd,buffer,0,buffer.length,Math.max(0,stat.size-buffer.length));}finally{fs.closeSync(fd);}
 const complete=buffer.toString('utf8').split('\n').some(line=>{try{const r=JSON.parse(line);return r.type==='turn.completed'||(r.method==='turn/completed'&&r.params?.turn?.status==='completed');}catch{return false;}});
 if(!complete)continue;
 const group=[stdout,stdout.replace(/\.stdout\.log$/,'.stderr.log')].filter(p=>fs.existsSync(p));
 if(group.some(p=>pinned.has(p)||!fs.lstatSync(p).isFile()||fs.lstatSync(p).isSymbolicLink()||fs.statSync(p).mtimeMs>=cutoff))continue;
 candidates++;bytes+=group.reduce((n,p)=>n+fs.statSync(p).size,0);
 if(apply){
  const current=JSON.parse(fs.readFileSync('.runtime/codex-runner-state.json','utf8'));
  if(!Array.isArray(current.pending))throw Error('Pending state changed or is invalid');
  const active=new Set(current.pending.flatMap(item=>Object.values(item.job?.logPaths??{})).map(p=>path.resolve(p)));
  if(group.some(p=>active.has(p)))continue;
  if(fs.statSync(stdout).mtimeMs!==stat.mtimeMs||fs.statSync(stdout).size!==stat.size)continue;
  for(const p of group){if(path.dirname(path.resolve(p))!==root)throw Error('Outside diagnostics directory');fs.unlinkSync(p);removed++;}
 }
}
console.log(JSON.stringify({mode:apply?'apply':'preview',days,eligibleCompletedRuns:candidates,eligibleBytes:bytes,removedFiles:removed,nativeHistoryChanged:false,lastMessagesPreserved:true},null,2));
