import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { confirmationForChat } from "./confirmations.js";
import type { ChatDetail, CodexRunJob } from "./types.js";

export function acknowledgmentDatabasePath() {
  const original = path.resolve('.runtime/acknowledgments.sqlite');
  const config = path.resolve('.runtime/acknowledgment-location.json');
  if (!fs.existsSync(config)) return original;
  const location = JSON.parse(fs.readFileSync(config, 'utf8')).path;
  if (typeof location !== 'string' || !path.isAbsolute(location)) throw Error('Acknowledgment database path must be absolute');
  const target = path.resolve(location);
  if (target === original) return original;
  if (fs.existsSync(original)) {
    if (fs.existsSync(target)) throw Error('Both acknowledgment database locations exist; refusing to overwrite either');
    fs.mkdirSync(path.dirname(target), {recursive:true});
    // Called at service startup, before the poller opens the database. Fold WAL
    // changes into the main file before moving it to its configured location.
    const source = new DatabaseSync(original);
    try {
      const checkpoint = source.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      if (checkpoint?.busy) throw Error('Acknowledgment database is busy; relocation deferred');
    } finally { source.close(); }
    fs.renameSync(original, target);
  }
  if (!fs.existsSync(target)) throw Error('Configured acknowledgment database is missing');
  return target;
}

export class ConfirmationTable {
  private db: DatabaseSync;
  constructor(file = acknowledgmentDatabasePath()) {
    const fresh = !fs.existsSync(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS Acknowledgment (
        id TEXT PRIMARY KEY NOT NULL, cid TEXT NOT NULL, word TEXT NOT NULL,
        summary TEXT NOT NULL, pending BOOLEAN NOT NULL DEFAULT TRUE CHECK(pending IN (0,1)),
        choice INTEGER DEFAULT NULL CHECK(choice IS NULL OR choice IN (1,2)));`);
    const legacy = path.join(path.dirname(file), 'confirmations.sqlite');
    if (fresh && fs.existsSync(legacy)) {
      const old = new DatabaseSync(legacy, {readOnly:true});
      try {
        this.db.exec('BEGIN');
        for (const row of old.prepare('SELECT * FROM confirmations').all())
          this.db.prepare('INSERT OR IGNORE INTO Acknowledgment VALUES (?,?,?,?,?,?)')
            .run(row.id,row.chatId,row.reply,row.summary,row.status==='pending'||row.status==='sending'?1:0,
              row.status==='accepted'||row.status==='sending'?1:row.status==='dismissed'?2:null);
        if(old.prepare("SELECT name FROM sqlite_master WHERE name='confirmation_decision_inbox'").get())
          for(const row of old.prepare("SELECT confirmationId,choice FROM confirmation_decision_inbox WHERE status IN ('queued','processing') ORDER BY createdAt,rowid").all())
            this.db.prepare('UPDATE Acknowledgment SET choice=? WHERE id=? AND pending=1 AND choice IS NULL').run(row.choice,row.confirmationId);
        this.db.exec('COMMIT');
      } catch(error) { this.db.exec('ROLLBACK'); throw error; }
      finally {old.close();}
    }
  }
  sync(chat:ChatDetail,jobs:CodexRunJob[],decision?:{status:string;job?:CodexRunJob}) {
    const pending=confirmationForChat(chat,jobs);
    this.db.prepare('UPDATE Acknowledgment SET pending=0 WHERE cid=? AND pending=1 AND id<>?').run(chat.id,pending?.id??'');
    if(pending) {
      this.db.prepare('INSERT OR IGNORE INTO Acknowledgment VALUES (?,?,?,?,1,NULL)').run(pending.id,chat.id,pending.reply,pending.summary);
      if(decision)this.set(chat.id,pending.id,decision.status);
    }
    return this.db.prepare('SELECT * FROM Acknowledgment WHERE cid=? AND pending=1 LIMIT 1').get(chat.id);
  }
  set(cid:string,id:string,status:string,_jobId?:string) {
    if(status==='sending')return;
    this.db.prepare('UPDATE Acknowledgment SET pending=0,choice=COALESCE(?,choice) WHERE cid=? AND id=?')
      .run(status==='accepted'?1:status==='dismissed'?2:null,cid,id);
  }
  list(pending?:boolean,cid?:string,limit=100,offset=0) {
    const flag=pending===undefined?null:pending?1:0;
    return this.db.prepare('SELECT * FROM Acknowledgment WHERE (? IS NULL OR pending=?) AND (? IS NULL OR cid=?) ORDER BY rowid LIMIT ? OFFSET ?')
      .all(flag,flag,cid??null,cid??null,limit,offset);
  }
  decisions() {return this.db.prepare('SELECT * FROM Acknowledgment WHERE pending=1 AND choice IN (1,2) ORDER BY rowid LIMIT 20').all();}
  close() {this.db.close();}
}
