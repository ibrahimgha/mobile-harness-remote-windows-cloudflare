import assert from "node:assert/strict";
import { isInjectedInstruction, readInjectedInstructionsPreference } from "../src/injectedMessages.js";
for(const text of ["# AGENTS.md instructions for C:\\project\nThese instructions replace previous instructions", "# AGENTS.md instructions\n<INSTRUCTIONS>rules</INSTRUCTIONS>","<environment_context>machine context</environment_context>","<skill>\n<name>skill</name>\ncontent</skill>","<turn_aborted>The user interrupted</turn_aborted>"]){
 assert.equal(isInjectedInstruction({role:"user",text}),true);
 assert.equal(isInjectedInstruction({role:"assistant",text}),false);
}
for(const text of ["Please update AGENTS.md instructions", "Explain <environment_context> tags", "Use $codex-remote-mobile for this task", "resume", "My instructions:\n# AGENTS.md instructions"])
 assert.equal(isInjectedInstruction({role:"user",text}),false);
assert.equal(readInjectedInstructionsPreference({getItem:()=>null}),false);
assert.equal(readInjectedInstructionsPreference({getItem:()=>"false"}),false);
assert.equal(readInjectedInstructionsPreference({getItem:()=>"true"}),true);
assert.equal(readInjectedInstructionsPreference({getItem:()=>{throw Error("unavailable")}}),false);
console.log("PASS: injected instructions hidden by default, explicit saved opt-in, ordinary prompts and assistant replies preserved.");
