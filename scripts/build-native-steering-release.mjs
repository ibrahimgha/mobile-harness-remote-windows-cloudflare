import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const full = process.argv.includes('--surface');
const includeMedia = !process.argv.includes('--no-media');
const option=(flag,fallback)=>{const index=process.argv.indexOf(flag);return index<0?fallback:process.argv[index+1];};
const releaseId=option('--id','native-steering-20260907');
if(!/^native-steering-[a-z0-9-]+$/.test(releaseId)) throw new Error('Invalid release ID');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8'}).trim()) throw new Error('Commit and push every source change before packaging');
const pushed=execFileSync('git',['ls-remote','origin','refs/heads/main'],{encoding:'utf8'}).trim().split(/\s+/)[0];
if(pushed!==sourceCommit) throw new Error('Release commit must match pushed main');
const source = path.resolve(option('--build-root','.runtime/steering-release'));
const target = path.resolve('.runtime',releaseId+(full?'-surface':''));
fs.mkdirSync(target,{recursive:true});
const files=[];
function add(relative,root=source) {
  const sourceFile=path.join(root,relative), targetFile=path.join(target,relative);
  fs.mkdirSync(path.dirname(targetFile),{recursive:true});fs.copyFileSync(sourceFile,targetFile);
  files.push({path:relative,sha256:createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex')});
}
for(const name of fs.readdirSync(path.join(source,'dist-server'),{recursive:true})) if(String(name).endsWith('.js')) add('dist-server/'+String(name).replaceAll('\\','/'));
const html=fs.readFileSync(path.join(source,'dist/index.html'),'utf8');
const assets=[...html.matchAll(/\/assets\/([^"']+)/g)].map(match=>match[1]);
// Include lazy chunks and PDF workers as well as index-linked bundles.
for(const asset of new Set([...assets, ...fs.readdirSync(path.join(source,'dist/assets'))])) add('dist/assets/'+asset);
if(includeMedia) for(const name of ['voice-orb-dream-line.gif','voice-orb-dream-line-poster.png','voice-orb-mongolia-ride.gif','voice-orb-mongolia-ride-poster.png','voice-orb-mojave-ride-playback.gif','voice-orb-mojave-ride-playback-poster.png']) add('dist/'+name);
if(full&&includeMedia) for(const name of ['voice-orb-beach-ride.gif','voice-orb-trail-ride.gif','voice-orb-beach-ride-poster.png','voice-orb-trail-ride-poster.png','voice-orb-water-test.gif','voice-orb-water-test-poster.png','model-bar-amber.gif','model-bar-fire.gif']) add('dist/'+name);
add('dist/index.html');
for(const file of ['sw.js','manifest.webmanifest']) add('dist/'+file);
// These separately linked mobile patches must travel with the compiled UI.
for(const file of ['mobile-search-focus.css','mobile-composer-layout.css','mobile-chat-actions.css','mobile-chat-actions.js','mobile-login-viewport.css']) add('dist/'+file);
for(const file of ['SKILL.md','agents/openai.yaml','references/handoffs.md','scripts/remote-chat.mjs']) add('skills/codex-remote-mobile/'+file,process.cwd());
fs.copyFileSync('scripts/install-native-steering-when-idle.mjs',path.join(target,'installer.mjs'));
fs.writeFileSync(path.join(target,'release.json'),JSON.stringify({id:releaseId,sourceCommit,versionControlled:true,cleanupStage:true,requiredBuiltins:['node:sqlite'],skillName:'codex-remote-mobile',queueReordering:releaseId.includes('queue-reorder'),javascript:assets.find(name=>name.endsWith('.js')),files},null,2)+'\n');
console.log(JSON.stringify({stage:target,files:files.length,surface:full}));
