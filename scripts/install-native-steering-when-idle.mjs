// One-shot, reboot-safe installer invoked by a Task Scheduler/systemd timer.
// Exit 75 means defer. This never stops a busy remote or changes UI profiles.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {parse} from 'dotenv';

const [projectArgument, stageArgument, service = 'mobile-harness-remote-windows-cloudflare.service', publicUrl] = process.argv.slice(2);
if (!projectArgument || !stageArgument) throw new Error('Project and staged release paths are required');
if (publicUrl) {
  const url=new URL(publicUrl);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash) throw new Error('A token-free public Remote URL is required');
}
const project = fs.realpathSync(projectArgument);
const stage = fs.realpathSync(stageArgument);
if (!stage.startsWith(project + path.sep) || stage === project) throw new Error('Stage must be a separate directory inside this project');
const release = JSON.parse(fs.readFileSync(path.join(stage, 'release.json'), 'utf8'));
if (!/^native-steering-[a-z0-9-]+$/.test(release.id)) throw new Error('Invalid release ID');
const runtime = path.join(project, '.runtime');
const marker = path.join(runtime, release.id + '.installed.json');
const logPath = path.join(runtime, release.id + '.install.log');
const backup = path.join(runtime, 'deploy-backups', release.id);
const resumePath = path.join(stage, 'resume-after-restart.json');
const config = parse(fs.readFileSync(path.join(project, '.env')));
const port = Number(config.PORT || 8787);
const headers = {'x-control-token': config.CONTROL_TOKEN || ''};
const log = message => { const line = new Date().toISOString() + ' ' + message; fs.appendFileSync(logPath, line + '\n'); console.log(line); };
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function copy(from, to) { fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(from, to); }
function save(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const stat = fs.existsSync(file) ? fs.statSync(file) : undefined;
  const temporary = file + '.install.tmp';
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n');
  if (stat && process.platform !== 'win32') fs.chownSync(temporary, stat.uid, stat.gid);
  fs.renameSync(temporary, file);
}
async function api(route) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {headers, signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`Health/state HTTP ${response.status}`);
  return response.json();
}
async function idle() {
  const state = await api('/api/state');
  const runner = state.runner;
  return runner && runner.activeJobs === 0 && runner.queuedJobs === 0 &&
    !(runner.recentJobs || []).some(job => job.status === 'running' || job.status === 'queued');
}
function serviceAction(action) {
  const command = process.platform === 'win32' ? 'powershell.exe' : 'systemctl';
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', path.join(project,'scripts','service.ps1'), action]
    : [action, service];
  // File-backed output avoids waiting for EOF on handles inherited by detached Windows children.
  const output = fs.openSync(logPath + '.service.log', 'a');
  let result;
  try { result = spawnSync(command, args, {cwd: project, windowsHide:true, stdio:['ignore',output,output], timeout:120000}); }
  finally { fs.closeSync(output); }
  if (result.error || result.status !== 0) throw new Error(`Service ${action} failed: ${result.error?.message || 'see service action log; exit ' + result.status}`);
}
function snapshotUi() {
  const files = [];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const base = path.join(process.env.LOCALAPPDATA, 'CodexRemoteWindowsApps');
    if (fs.existsSync(base)) for (const entry of fs.readdirSync(base, {withFileTypes:true})) {
      if (!entry.isDirectory() || !entry.name.startsWith('CodexControlRoom')) continue;
      for (const name of ['control-room-state.json','window-state.json']) {
        const file = path.join(base, entry.name, name);
        if (fs.existsSync(file)) files.push(file);
      }
    }
  }
  const piState = '/home/vm13/.config/codex-control-room-native/state.json';
  if (process.platform !== 'win32' && fs.existsSync(piState)) files.push(piState);
  return files.map((file,index) => {
    copy(file, path.join(backup, 'ui-state', `${index}-${path.basename(file)}`));
    return {file, sha256:sha(file)};
  });
}
function scheduleResume() {
  if (!fs.existsSync(resumePath)) return;
  const resume = JSON.parse(fs.readFileSync(resumePath,'utf8'));
  if (!resume.chatId || !resume.text || !resume.settings) throw new Error('Incomplete persisted resume plan');
  const journalPath = config.CODEX_RUNNER_STATE_PATH ? path.resolve(project,config.CODEX_RUNNER_STATE_PATH) : path.join(runtime,'codex-runner-state.json');
  const journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath,'utf8')) : {version:1,pending:[]};
  if (journal.version !== 1 || !Array.isArray(journal.pending)) throw new Error('Unexpected runner journal; refusing to overwrite it');
  const id = release.id + '-verification';
  if (journal.pending.some(entry => entry.job?.id === id)) return;
  const createdAt = new Date().toISOString();
  const logBase = path.join(project,'logs','codex-runs', createdAt.replace(/[:.]/g,'-') + '-prompt-' + resume.chatId + '-' + id);
  journal.pending.push({text:resume.text,job:{
    id, clientRequestId:id, chatId:resume.chatId, projectPath:project, status:'queued', kind:'prompt',
    createdAt, promptPreview:'resume Remote deployment verification', inputSource:'typed',
    promptHash:createHash('sha256').update(resume.text).digest('hex'), textLength:resume.text.length,
    command:[], settings:resume.settings, message:'Scheduled deployment verification after restart',
    logPaths:{stdout:logBase+'.stdout.log',stderr:logBase+'.stderr.log',lastMessage:logBase+'.last-message.txt'}
  }});
  save(journalPath,journal);
  log('Persisted same-model/reasoning resume prompt before service start');
}

async function main() {
  if (fs.existsSync(marker)) { log('Already installed; no action'); return; }
  for (const entry of release.files) {
    const runtimeFile=/^(dist|dist-server)\/[a-zA-Z0-9_./-]+$/.test(entry.path);
    const skillFile=/^skills\/codex-remote-mobile\/(SKILL\.md|agents\/openai\.yaml|references\/handoffs\.md|scripts\/remote-chat\.mjs)$/.test(entry.path);
    if ((!runtimeFile&&!skillFile) || entry.path.split('/').includes('..')) throw new Error('Unexpected release target');
    if (sha(path.join(stage,entry.path)) !== entry.sha256) throw new Error('Staged file checksum mismatch: ' + entry.path);
  }
  if (!await idle()) { log('Deferred: active or queued jobs remain'); process.exitCode=75; return; }
  await delay(3000);
  if (!await idle()) { log('Deferred: new work arrived during idle confirmation'); process.exitCode=75; return; }
  const ui = snapshotUi();
  save(path.join(backup,'ui-before.json'),ui);
  for (const entry of release.files) {
    const target = path.join(project,entry.path);
    const previous = path.join(backup,entry.path);
    if (fs.existsSync(target) && !fs.existsSync(previous)) copy(target,previous);
  }
  if (publicUrl) {
    const connection=path.join(runtime,'codex-remote-connection.json');
    const previous=path.join(backup,'connection-before.json');
    if(fs.existsSync(connection)&&!fs.existsSync(previous)) copy(connection,previous);
    const existing=fs.existsSync(connection)?JSON.parse(fs.readFileSync(connection,'utf8')):{};
    save(connection,{...existing,publicUrl});
  }
  if (!await idle()) { log('Deferred: work arrived while backups were being saved'); process.exitCode=75; return; }
  log('Idle reconfirmed after backups; stopping only the remote service');
  serviceAction('stop');
  try {
    // Retain all old hashed assets. Publish index only after the matching files.
    for (const entry of [...release.files].sort((a,b) => Number(a.path==='dist/index.html') - Number(b.path==='dist/index.html'))) {
      copy(path.join(stage,entry.path),path.join(project,entry.path));
    }
    scheduleResume();
  } catch (error) {
    for (const entry of release.files) {
      const previous = path.join(backup,entry.path);
      if (fs.existsSync(previous)) copy(previous,path.join(project,entry.path));
    }
    serviceAction('start');
    throw error;
  }
  serviceAction('start');
  let healthy = false, installedSkill;
  for (let attempt=0; attempt<15; attempt++) {
    await delay(2000);
    try {
      const state=await api('/api/state');
      if (state.runner?.mode === 'codex-app-server' && (!release.skillName || state.runner?.skill?.name===release.skillName) &&
          (!release.queueReordering || state.runner?.queueReordering === true)) {
        installedSkill=state.runner.skill;healthy=true;break;
      }
    } catch {}
  }
  if (!healthy) throw new Error('New backend not verified; backups retained. No blind second restart.');
  for (const entry of release.files) if (sha(path.join(project,entry.path)) !== entry.sha256) throw new Error('Installed file checksum mismatch: '+entry.path);
  const index = await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(10000)}).then(r=>r.text());
  if (!index.includes(release.javascript)) throw new Error('Server is not serving the staged frontend');
  const uiAfter = ui.map(item => ({...item,unchanged:fs.existsSync(item.file)&&sha(item.file)===item.sha256}));
  save(marker,{release:release.id,installedAt:new Date().toISOString(),nativeMode:true,skill:installedSkill,ui:uiAfter});
  log('PASS: native backend, bundled skill, frontend, checksums verified; UI profile files were not modified by installer');
}
main().catch(error => {log('Deferred/error: '+error.message);process.exitCode=1;});
