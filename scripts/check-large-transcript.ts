import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { constants } from "node:buffer";
import { parseSessionFile, resolveTranscriptTailBytes } from "../server/codexSessions.js";
import { transcriptLines } from "../server/transcriptLines.js";

const large = process.argv.includes("--large");
const root = await fs.mkdtemp(path.join(large && process.platform === "win32" ? "D:/" : os.tmpdir(), "remote-transcript-test-"));
const file = path.join(root, "rollout-11111111-2222-4333-8444-555555555555.jsonl");
const id = "11111111-2222-4333-8444-555555555555";
const item = (role: string, text: string) => JSON.stringify({timestamp:"2026-11-23T00:00:00Z",type:"response_item",payload:{type:"message",role,content:[{type:role==="user"?"input_text":"output_text",text}]}})+"\n";
try {
  const fd = await fs.open(file, "w");
  const filler = Buffer.from((JSON.stringify({type:"ignored",payload:{text:"x".repeat(1000)}})+"\n").repeat(1000));
  try {
    await fd.write(JSON.stringify({type:"session_meta",payload:{id,cwd:root}})+"\n"+item("user","old prompt"));
    const target = large ? constants.MAX_STRING_LENGTH + 2 * 1024 * 1024 : 2 * 1024 * 1024;
    for(let bytes=0;bytes<target;bytes+=filler.length) await fd.write(filler);
    await fd.write(item("user","new prompt")+item("assistant","latest answer"));
  } finally { await fd.close(); }
  const size = (await fs.stat(file)).size;
  const detail = await parseSessionFile(file,new Map(),{maxTailBytes:size,detailedTailBytes:4096,detailTurns:1,messageMode:"final"});
  assert.deepEqual(detail?.messages.filter(m=>m.role!=="system").map(m=>m.text),["new prompt","latest answer"]);
  await resolveTranscriptTailBytes(file,size,large?constants.MAX_STRING_LENGTH+1:1024,3);
  let latest="";for await(const line of transcriptLines(file))if(line.includes('"role":"assistant"'))latest=line;
  assert.match(latest,/latest answer/);
  console.log(`Large transcript streaming passed (${size} bytes).`);
} finally { await fs.rm(root,{recursive:true,force:true}); }
