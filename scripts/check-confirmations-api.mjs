import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const project=process.cwd();
const root=fs.mkdtempSync(path.join(os.tmpdir(),'remote-confirmation-api-'));
fs.cpSync(path.join(project,'skills'),path.join(root,'skills'),{recursive:true});
const sessions=path.join(root,'sessions');fs.mkdirSync(sessions);
const chatId='11111111-1111-4111-8111-111111111111';
const otherId='22222222-2222-4222-8222-222222222222';
function seed(id){
 const time=Date.now()-5000;
 const record=(type,payload,offset=0)=>JSON.stringify({timestamp:new Date(time+offset).toISOString(),type,payload});
 fs.writeFileSync(path.join(sessions,`rollout-${id}.jsonl`),[
  record('session_meta',{id,cwd:root,source:'cli'}),
  record('event_msg',{type:'task_started',turn_id:'fixture-turn'}),
  record('turn_context',{model:'gpt-6-astra',effort:'max'}),
  record('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'Please prepare the change.'}]},1000),
  record('response_item',{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'Ready to deploy.\n<!-- codex-confirmation: {"reply":"confirmed","summary":"Deploy the prepared change"} -->'}]},2000)
 ].join('\n')+'\n');
}
seed(chatId);seed(otherId);
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
const port=socket.address().port;await new Promise(r=>socket.close(r));
let child;let output='';
const headers={'x-control-token':'isolated-confirmation-fixture','content-type':'application/json'};
async function call(route,body){const response=await fetch(`http://127.0.0.1:${port}${route}`,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}
async function start(){
 child=spawn(process.execPath,[path.join(project,'dist-server/server/index.js')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:String(port),CONTROL_TOKEN:headers['x-control-token'],CONTROL_TOKENS:'',ENABLE_WINDOW_CONTROL:'false',CODEX_RUN_MODE:'simulation',CODEX_RUN_ENABLED:'false',CODEX_SESSIONS_DIR:sessions,CODEX_SESSION_INDEX:path.join(root,'session-index.jsonl'),CODEX_REMOTE_SKILLS_DIR:path.join(root,'installed-skills'),CODEX_RUNNER_STATE_PATH:path.join(root,'.runtime/runner.json'),CODEX_ACTIVITY_TERMINAL_STATE:path.join(root,'.runtime/terminals.json')}});
 child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 for(let i=0;i<100;i++){try{if((await call('/api/state')).status===200)return;}catch{}await delay(100);}
 throw Error('Fixture server failed: '+output);
}
async function stop(){if(!child||child.exitCode!==null)return;const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}
try{
 await start();
 const index=(await call('/api/acknowledgments?pending=true&refresh=1')).data;
 assert.equal(index.scanError,null);
 assert.equal(index.acknowledgments.length,2);
 const row=index.acknowledgments.find(row=>row.cid===chatId);
 assert.deepEqual(Object.keys(row).sort(),['id','cid','word','summary','pending','choice'].sort());
 assert.equal(row.word,'confirmed');assert.equal(row.pending,true);assert.equal(row.choice,null);
 const dbFile=path.join(root,'.runtime/acknowledgments.sqlite');
 let db=new DatabaseSync(dbFile);
 assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name),['Acknowledgment']);
 db.prepare('UPDATE Acknowledgment SET choice=1 WHERE id=? AND pending=1').run(row.id);
 db.close();
 const results=await Promise.all(Array.from({length:3},()=>call('/api/chats/'+chatId+'/confirmation',{id:row.id,action:'accept'})));
 for(const result of results)assert.equal(result.status,202,JSON.stringify(result));
 const job=results[0].data.job;
 assert.equal(new Set(results.map(r=>r.data.job.id)).size,1);
 for(let i=0;i<60;i++){
   if(!(await call('/api/chats/'+chatId)).data.pendingConfirmation)break;
   await delay(100);
 }
 assert.equal((await call('/api/chats/'+chatId)).data.pendingConfirmation,undefined);
 await stop();
 db=new DatabaseSync(dbFile);
 assert.equal(db.prepare('SELECT pending FROM Acknowledgment WHERE id=?').get(row.id).pending,0);
 db.prepare('UPDATE Acknowledgment SET pending=1,choice=1 WHERE id=?').run(row.id);
 db.prepare('UPDATE Acknowledgment SET choice=2 WHERE cid=?').run(otherId);
 db.close();
 await start();
 for(let i=0;i<80;i++){
   const rows=(await call('/api/acknowledgments')).data.acknowledgments;
   if(rows.every(r=>!r.pending))break;
   await delay(100);
 }
 const rows=(await call('/api/acknowledgments')).data.acknowledgments;
 assert.equal(rows.length,2);assert.ok(rows.every(r=>!r.pending));
 assert.equal(rows.find(r=>r.cid===chatId).choice,1);
 assert.equal(rows.find(r=>r.cid===otherId).choice,2);
 const journal=JSON.parse(fs.readFileSync(path.join(root,'.runtime/runner.json'),'utf8'));
 assert.equal(journal.pending.length,1,'Restart and SQL/UI races must not duplicate prompts');
 assert.equal(journal.pending[0].job.id,job.id);
 assert.equal(journal.pending[0].text,'confirmed');
 assert.equal((await call('/api/chats/'+otherId)).data.pendingConfirmation,undefined);
 console.log('PASS: six-field single table, direct SQL choices, restart processing, SQL/UI deduplication and dismissal.');
}catch(error){console.error(output);throw error;}finally{await stop();fs.rmSync(root,{recursive:true,force:true});}
