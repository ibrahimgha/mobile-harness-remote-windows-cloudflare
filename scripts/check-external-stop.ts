import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {stopExternalCodexRun} from '../server/externalRunControl.js';
// Harmless standalone process, never a real Codex job or user chat.
const id='00000000-0000-4000-8000-000000000071';
if(process.platform==='win32'){
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)','--','resume',id],{windowsHide:true,stdio:'ignore'});
 await once(child,'spawn');
 try {
  const exit=once(child,'exit');
  const result=await stopExternalCodexRun(id);
  assert.deepEqual(result.matchedProcessIds,[child.pid]);
  assert.deepEqual(result.stoppedProcessIds,[child.pid]);
  await exit;
  console.log('External stop: only the selected disposable worker was terminated');
 }finally{child.kill()}
}
