import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {acknowledgmentDatabasePath} from '../.runtime/acknowledgment-location-build/server/confirmationTable.js';
const cwd=process.cwd();
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ack-location-'));
try {
  process.chdir(root);fs.mkdirSync('.runtime');
  const source=path.resolve('.runtime/acknowledgments.sqlite');
  const target=path.resolve('Desktop/random.sqlite');
  const db=new DatabaseSync(source);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE Acknowledgment(id TEXT,cid TEXT,word TEXT,summary TEXT,pending BOOLEAN,choice INTEGER); INSERT INTO Acknowledgment VALUES('question','chat','proceed','test',1,2)");
  db.close();
  fs.writeFileSync('.runtime/acknowledgment-location.json',JSON.stringify({path:target}));
  assert.equal(acknowledgmentDatabasePath(),target);
  assert.equal(fs.existsSync(source),false);
  const moved=new DatabaseSync(target,{readOnly:true});
  assert.equal(moved.prepare('SELECT choice FROM Acknowledgment').get().choice,2);
  assert.equal(moved.prepare('PRAGMA quick_check').get().quick_check,'ok');moved.close();
  assert.equal(acknowledgmentDatabasePath(),target,'Restart reuses the new path');
  fs.writeFileSync(source,'collision');
  assert.throws(()=>acknowledgmentDatabasePath(),/Both acknowledgment/);
  console.log('PASS: relocation retains rows, restart uses configured path, collision preserves both files.');
}finally{process.chdir(cwd);fs.rmSync(root,{recursive:true,force:true});}
