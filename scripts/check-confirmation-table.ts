import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ConfirmationTable } from "../server/confirmationTable.js";
import type { ChatDetail } from "../server/types.js";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"acknowledgment-table-"));
const file=path.join(root,"acknowledgments.sqlite");
const legacy=new DatabaseSync(path.join(root,"confirmations.sqlite"));
legacy.exec(`CREATE TABLE confirmations(id TEXT,chatId TEXT,reply TEXT,summary TEXT,status TEXT);
INSERT INTO confirmations VALUES('old','old-chat','proceed','Original question','pending');
CREATE TABLE confirmation_decision_inbox(confirmationId TEXT,choice INTEGER,status TEXT,createdAt TEXT);
INSERT INTO confirmation_decision_inbox VALUES('old',2,'queued','2026-09-13');`);
legacy.close();
let table=new ConfirmationTable(file);
const chat={id:"chat",title:"Test",projectName:"Project",projectPath:root,messages:[{
role:"assistant",text:"Shall I deploy it?",createdAt:"2026-09-13T10:00:00Z",model:"gpt-6-astra",reasoningEffort:"max"
}]} as ChatDetail;
try {
 assert.equal(table.decisions()[0].choice,2,'Import an already submitted legacy choice');
 const row=table.sync(chat,[])!;
 assert.deepEqual(Object.keys(row).sort(),['id','cid','word','summary','pending','choice'].sort());
 assert.equal(row.pending,1);
 table.close();table=new ConfirmationTable(file);
 assert.equal(table.list(true).length,2);
 table.sync({...chat,messages:[...chat.messages,{...chat.messages[0],role:"user",text:"Wait"}]},[]);
 assert.equal(table.list(true,"chat").length,0);
 table.sync(chat,[]);
 assert.equal(table.list(true,"chat").length,0);
 console.log("PASS: migration, single six-field table, persistence, stale question closure.");
}finally{table.close();fs.rmSync(root,{recursive:true,force:true});}
