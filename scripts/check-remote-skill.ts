import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureRemoteSkill } from "../server/remoteSkill.js";
import { promptInputSource, stripRemotePromptContext, withRemotePromptContext } from "../server/remotePromptContext.js";
import { getRunSettings, PromptSettingsError, settingsForPrompt } from "../server/runSettings.js";
import { readChatDraftSource, writeChatDraft, writeChatDraftSource } from "../src/chatDrafts.js";
import { CodexRunner } from "../server/codexRunner.js";
import { run } from "../skills/codex-remote-mobile/scripts/remote-chat.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-skill-"));
try {
  const project = path.join(temp, "remote");
  fs.mkdirSync(project, { recursive: true });
  fs.cpSync(path.resolve("skills"), path.join(project,"skills"), { recursive: true });
  fs.mkdirSync(path.join(project,".runtime"));
  fs.writeFileSync(path.join(project,".runtime/codex-remote-connection.json"), JSON.stringify({publicUrl:"https://remote.example"}));
  const options = { projectRoot:project, skillsRoot:path.join(temp,"user-skills"), env:{PORT:"8877",REMOTE_SERVER_NAME:"Fixture"} };
  const installed = ensureRemoteSkill(options);
  assert.ok(fs.existsSync(installed.path));
  const firstMtime = fs.statSync(installed.path).mtimeMs;
  ensureRemoteSkill(options);
  assert.equal(fs.statSync(installed.path).mtimeMs, firstMtime, "an unchanged startup leaves the skill alone");
  fs.appendFileSync(installed.path, "\nLocal user customization\n");
  ensureRemoteSkill(options);
  assert.ok(fs.readdirSync(path.join(project,".runtime/skill-backups/codex-remote-mobile")).length > 0, "overwritten customizations have a recoverable backup");
  assert.equal(fs.readFileSync(installed.path,"utf8"),fs.readFileSync("skills/codex-remote-mobile/SKILL.md","utf8"));
  const connection=JSON.parse(fs.readFileSync(installed.connectionFile,"utf8"));
  assert.equal(connection.baseUrl,"http://127.0.0.1:8877");
  assert.equal(connection.publicUrl,"https://remote.example");
  assert.equal(connection.envFile,path.join(project,".env"));
  assert.equal(connection.token,undefined);

  const original="Please update Nahla's Huly board.\nKeep this exact second line.";
  for (const inputSource of ["typed","voice","mixed"] as const) {
    const prepared=withRemotePromptContext(original,{chatId:"chat",inputSource,skill:installed});
    assert.equal(stripRemotePromptContext(prepared),original);
    assert.match(prepared, /\$codex-remote-mobile/);
    assert.equal(prepared.includes("transcribed to text"),inputSource!=="typed");
  }
  assert.equal(stripRemotePromptContext("ordinary text <codex_remote_context>"),"ordinary text <codex_remote_context>");
  assert.equal(promptInputSource({}),"typed");

  const memory=new Map<string,string>();
  const storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);}};
  writeChatDraft(storage,"chat",original);
  writeChatDraftSource(storage,"chat","voice");
  writeChatDraft(storage,"chat",original+" A typed edit.");
  assert.equal(readChatDraftSource(storage,"chat"),"voice");
  assert.equal(readChatDraftSource(storage,"other"),"typed");
  writeChatDraft(storage,"chat","");
  assert.equal(readChatDraftSource(storage,"chat"),"typed");

  const before=getRunSettings();
  const perPrompt=settingsForPrompt({model:"gpt-5.6-sol",reasoningEffort:"low",speed:"default"});
  assert.equal(perPrompt?.model,"gpt-5.6-sol");
  assert.deepEqual(getRunSettings(),before,"a handoff must not change the global slider");
  assert.throws(()=>settingsForPrompt({reasoningEffort:"not-an-effort"}),PromptSettingsError);
  assert.throws(()=>settingsForPrompt({model:"__proto__"}),PromptSettingsError);
  assert.ok(settingsForPrompt({model:"gpt-5.4-mini"}),"model-only selection uses compatible defaults");

  const journal=path.join(temp,"runner.json");
  const runner=new CodexRunner({statePath:journal});
  (runner as unknown as {runningChatIds:Set<string>}).runningChatIds.add("voice-chat");
  const job=runner.enqueue({chatId:"voice-chat",projectPath:temp,text:original,promptPreview:original,promptHash:createHash("sha256").update(original).digest("hex"),textLength:original.length,inputSource:"voice"});
  const restored=new CodexRunner({statePath:journal});
  assert.equal(restored.jobsForChat("voice-chat")[0].inputSource,"voice");
  assert.equal(restored.cancelQueuedJob(job.id,"voice-chat")?.text,original);

  const secret="fixture-only-access-key";
  const envFile=path.join(temp,"fixture.env");
  fs.writeFileSync(envFile,`CONTROL_TOKEN="${secret}"\n`);
  const helperConnection=path.join(temp,"connection.json");
  fs.writeFileSync(helperConnection,JSON.stringify({...connection,projectRoot:process.cwd(),envFile}));
  const promptFile=path.join(temp,"handoff.md");fs.writeFileSync(promptFile,original);
  const requests: Array<{url:URL;init:RequestInit}>=[];
  const fetcher=async (url:URL,init:RequestInit)=>{
    requests.push({url,init});
    assert.equal((init.headers as Record<string,string>)["x-control-token"],secret);
    if(url.pathname.endsWith("/prompt")) {
      const body=JSON.parse(String(init.body));
      assert.equal(body.clientRequestId,"handoff-123");
      assert.equal(body.text,original);
      assert.equal(body.inputSource,"voice");
      return Response.json({disposition:"queued",job:{id:"tracked-job",chatId:"target",status:"queued",settings:body.settings,message:secret}});
    }
    if(url.pathname.endsWith("/jobs")) return Response.json({jobs:[{id:"tracked-job",chatId:"target",status:"running"}]});
    return Response.json({projects:[{projectName:"Accounts",projectPath:"/project",chats:[{id:"target",title:"Billing worker"}]}]});
  };
  const args=["prompt","--connection",helperConnection,"--chat","target","--text-file",promptFile,"--request-id","handoff-123","--source","voice","--model","gpt-5.6-sol","--reasoning","low"];
  const receipt=await run(args,{fetcher});
  assert.equal(receipt.job.id,"tracked-job");
  assert.equal(receipt.chatUrl,"https://remote.example/?chat=target");
  assert.ok(!JSON.stringify(receipt).includes(secret),"receipts redact the credential even if the server echoes it");
  assert.equal(requests.length,1,"dispatch is one tracked API call, not another CLI process");
  const status=await run(["status","--connection",helperConnection,"--chat","target","--job","tracked-job"],{fetcher});
  assert.equal(status.jobs[0].status,"running");
  assert.equal(requests.at(-1)?.init.method,"GET");
  const projects=await run(["chats","--connection",helperConnection,"--query","Accounts"],{fetcher});
  assert.equal(projects.projects[0].name,"Accounts");
  assert.equal(projects.projects[0].path,"/project");
  assert.equal(projects.projects[0].chats[0].title,"Billing worker");
  await assert.rejects(run(["prompt","--connection",helperConnection,"--chat","target","--text-file",promptFile],{fetcher}),/request-id/);
  await assert.rejects(run(args,{fetcher:async()=>Response.json({message:secret},{status:401})}),(error:Error)=>!error.message.includes(secret)&&error.message.includes("401"));

  // The renderer sees the user's text, not the skill invocation/preamble.
  const sessions=path.join(temp,"sessions");fs.mkdirSync(sessions);
  const chatId="00000000-0000-0000-0000-000000000001";
  const prepared=withRemotePromptContext(original,{chatId,inputSource:"voice",skill:installed});
  fs.writeFileSync(path.join(sessions,`rollout-${chatId}.jsonl`),[
    {type:"session_meta",payload:{id:chatId,cwd:project,source:"cli",timestamp:new Date().toISOString()}},
    {type:"response_item",timestamp:new Date().toISOString(),payload:{type:"message",role:"user",content:[{type:"input_text",text:"<recommended_plugins>Available plugins</recommended_plugins>\n<environment_context>Machine context</environment_context>"}]}},
    {type:"response_item",timestamp:new Date().toISOString(),payload:{type:"message",role:"user",content:[{type:"input_text",text:prepared}]}},
    {type:"response_item",timestamp:new Date().toISOString(),payload:{type:"message",role:"user",content:[{type:"input_text",text:`<skill>\n<name>codex-remote-mobile</name>\n<path>${installed.path}</path>\nSkill content\n</skill>`}]}},
    {type:"response_item",timestamp:new Date().toISOString(),payload:{type:"message",role:"assistant",phase:"final_answer",content:[{type:"output_text",text:"Ready\n\n<!-- codex-notification: Worker setup is ready -->"}]}}
  ].map(item=>JSON.stringify(item)).join("\n")+"\n");
  const previousSessions=process.env.CODEX_SESSIONS_DIR;
  process.env.CODEX_SESSIONS_DIR=sessions;
  const {getChat}=await import("../server/codexSessions.js");
  const parsed=await getChat(chatId);
  assert.ok(parsed?.messages?.some(message=>message.role==="user"&&message.text===original));
  assert.equal(parsed?.messages?.filter(message=>message.role==="user").length,1,"native context stays out of prompt bubbles");
  assert.equal(parsed?.lastPrompt?.text,original,"skill content never takes over the prompt preview");
  assert.equal(parsed?.lastResponse?.text,"Ready","notification metadata stays out of displayed replies");
  assert.equal(parsed?.messagePage?.totalTurns,1,"context-only native messages are excluded from pagination");
  if(previousSessions===undefined) delete process.env.CODEX_SESSIONS_DIR;else process.env.CODEX_SESSIONS_DIR=previousSessions;
  console.log("Remote skill: installation/update backups, voice lifecycle, clean transcripts, per-prompt settings, authenticated handoffs, receipts and credential redaction passed.");
} finally {
  fs.rmSync(temp,{recursive:true,force:true});
}
