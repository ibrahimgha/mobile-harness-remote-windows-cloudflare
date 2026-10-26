import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { zstdCompressSync } from "node:zlib";
import { compressedSessionRows, materializeSession, restoreCompressedChat } from "../server/sessionArchive.js";

const root=await fs.mkdtemp(path.join(os.tmpdir(),"remote-session-archive-"));
const sessions=path.join(root,"sessions");
const previousRoot=process.env.CODEX_SESSIONS_DIR, previousIndex=process.env.CODEX_SESSION_INDEX;
let db:DatabaseSync|undefined;
try {
  await fs.mkdir(sessions);
  process.env.CODEX_SESSIONS_DIR=sessions;
  process.env.CODEX_SESSION_INDEX=path.join(root,"session_index.jsonl");
  db=new DatabaseSync(path.join(root,"state_5.sqlite"));
  db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, title TEXT, created_at INTEGER, updated_at INTEGER, first_user_message TEXT, source TEXT, thread_source TEXT, archived INTEGER)");
  const insert=db.prepare("INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?,?)");
  const id=(i:number)=>`00000000-0000-0000-0000-${String(i).padStart(12,"0")}`;
  const file=(i:number)=>path.join(sessions,`rollout-${id(i)}.jsonl`);
  const content=(i:number)=>[
    {timestamp:"2026-10-01T12:00:00Z",type:"session_meta",payload:{id:id(i),cwd:root,source:"vscode"}},
    {timestamp:"2026-10-01T12:00:00Z",type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:`Original prompt ${i}`}]}},
    {timestamp:"2026-10-01T12:01:00Z",type:"response_item",payload:{type:"message",role:"assistant",phase:"final_answer",content:[{type:"output_text",text:`Original answer ${i}`}]}}
  ].map(row=>JSON.stringify(row)).join("\n")+"\n";
  for(let i=1;i<=350;i++) {
    await fs.writeFile(file(i)+".zst",zstdCompressSync(content(i)));
    insert.run(id(i),file(i),root,`Older chat ${i}`,1790856000,1790856060,"Original prompt","vscode","user",0);
  }
  insert.run(id(351),file(351),root,"Hidden subagent",1,2,"","{\"subagent\":{\"other\":\"worker\"}}","subagent",0);
  await fs.writeFile(file(351)+".zst",zstdCompressSync(content(351)));
  insert.run(id(352),file(352),root,"Intentionally archived",1,2,"","vscode","user",1);
  await fs.writeFile(file(352)+".zst",zstdCompressSync(content(352)));
  insert.run(id(353),path.join(root,`outside-${id(353)}.jsonl`),root,"Outside root",1,2,"","vscode","user",0);
  await fs.writeFile(path.join(root,`outside-${id(353)}.jsonl.zst`),zstdCompressSync(content(353)));
  assert.equal(compressedSessionRows(sessions).length,350);
  const {listChats,getChat,clearSessionCache}=await import("../server/codexSessions.js");
  assert.equal((await listChats()).totalChats,350,"sidebar includes compressed chats beyond old 300 limit without extracting them");
  assert.equal((await fs.readdir(sessions)).filter(f=>f.endsWith(".jsonl")).length,0);
  const selected=await getChat(id(1));
  assert.equal(selected?.lastPrompt?.text,"Original prompt 1");
  assert.equal(selected?.lastResponse?.text,"Original answer 1");
  assert.equal(await fs.readFile(file(1),"utf8"),content(1));
  assert.equal((await fs.readdir(sessions)).filter(f=>f.endsWith(".jsonl")).length,1,"only selected chat expands");
  await Promise.all([materializeSession(file(2)),materializeSession(file(2))]);
  assert.equal(await fs.readFile(file(2),"utf8"),content(2),"concurrent opens coalesce without overwriting history");
  await fs.writeFile(file(2),"New live writer contents");
  await materializeSession(file(2));
  assert.equal(await fs.readFile(file(2),"utf8"),"New live writer contents");
  await restoreCompressedChat(id(3));
  assert.equal(await fs.readFile(file(3),"utf8"),content(3),"native runner can hydrate without opening chat first");
  const broken=path.join(sessions,"broken.jsonl");
  await fs.writeFile(broken+".zst","corrupt frame");
  await assert.rejects(materializeSession(broken));
  assert.equal((await fs.readdir(sessions)).some(f=>f.endsWith(".tmp")),false,"partial restores clean up on corruption");
  assert.equal((await fs.readdir(sessions)).includes("broken.jsonl"),false);
  for(let i=1000;i<1305;i++) await fs.writeFile(file(i),content(i));
  // The deliberately overwritten fixture above is no longer a valid transcript.
  await fs.writeFile(file(2),content(2));
  clearSessionCache();
  const all=await listChats();
  assert.equal(all.totalChats,655,"all plain and compressed user chats remain visible, with no duplicates or 300-file truncation");
  console.log("PASS: 655 plain/compressed chats, metadata-only listing, selected/native restore, exact history, concurrency, live-writer preservation, corrupted-frame cleanup and subagent/archive/path exclusions.");
} finally {
  db?.close();
  if(previousRoot===undefined)delete process.env.CODEX_SESSIONS_DIR;else process.env.CODEX_SESSIONS_DIR=previousRoot;
  if(previousIndex===undefined)delete process.env.CODEX_SESSION_INDEX;else process.env.CODEX_SESSION_INDEX=previousIndex;
  await fs.rm(root,{recursive:true,force:true});
}
