import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config";
import { Analysis } from "./types";

// Node.js 26 provides a built-in synchronous SQLite driver. This removes the
// native better-sqlite3/node-gyp dependency and keeps the same SQLite schema
// and SQL semantics used by the application.
const dbPath = path.resolve(config.db);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath, {
  timeout: 5000,
  enableForeignKeyConstraints: true,
  defensive: true
});

db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  input_type TEXT NOT NULL,
  input_label TEXT NOT NULL,
  network TEXT,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  analysis_json TEXT NOT NULL,
  anonymous_session TEXT
);
CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses(created_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  event TEXT NOT NULL,
  input_type TEXT,
  network TEXT,
  duration_ms INTEGER,
  status TEXT,
  anonymous_session TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  input_type TEXT NOT NULL,
  input_label TEXT NOT NULL,
  network TEXT,
  baseline_json TEXT NOT NULL,
  last_check_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES admin_users(id)
);
`);

function scryptHash(password:string, salt=crypto.randomBytes(16).toString("hex")) {
  const hash=crypto.scryptSync(password,salt,64).toString("hex");
  return `${salt}:${hash}`;
}
function scryptVerify(password:string, stored:string) {
  const [salt,hash]=stored.split(":");
  if(!salt||!hash)return false;
  const candidate=crypto.scryptSync(password,salt,64).toString("hex");
  const expected=Buffer.from(hash,"hex");
  const actual=Buffer.from(candidate,"hex");
  return expected.length===actual.length && crypto.timingSafeEqual(actual,expected);
}

export function ensureAdminUser(username:string,password:string) {
  const existing=db.prepare("SELECT id FROM admin_users WHERE username=?").get(username);
  if(existing)return;
  db.prepare("INSERT INTO admin_users(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)")
    .run(crypto.randomUUID(),username,scryptHash(password),"admin",new Date().toISOString());
}

export function verifyAdmin(username:string,password:string) {
  const row=db.prepare("SELECT * FROM admin_users WHERE username=? AND disabled=0").get(username) as any;
  if(!row || !scryptVerify(password,row.password_hash))return null;
  return {id:row.id,username:row.username,role:row.role};
}

export function saveRefreshToken(userId:string, raw:string, expiresAt:string) {
  const hash=crypto.createHash("sha256").update(raw).digest("hex");
  db.prepare("INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)")
    .run(crypto.randomUUID(),userId,hash,expiresAt,new Date().toISOString());
}
export function consumeRefreshToken(raw:string) {
  const hash=crypto.createHash("sha256").update(raw).digest("hex");
  const row=db.prepare("SELECT * FROM refresh_tokens WHERE token_hash=? AND revoked_at IS NULL").get(hash) as any;
  if(!row || new Date(row.expires_at)<=new Date())return null;
  db.prepare("UPDATE refresh_tokens SET revoked_at=? WHERE id=?").run(new Date().toISOString(),row.id);
  const user=db.prepare("SELECT id,username,role,disabled FROM admin_users WHERE id=?").get(row.user_id) as any;
  if(!user || user.disabled)return null;
  return user;
}

export function saveAnalysis(a: Analysis, session: string) {
  db.prepare(`INSERT OR REPLACE INTO analyses
    (id,created_at,input_type,input_label,network,status,duration_ms,analysis_json,anonymous_session)
    VALUES (@id,@createdAt,@inputType,@inputLabel,@network,@status,@durationMs,@json,@session)`)
    .run({id:a.id,createdAt:a.createdAt,inputType:a.inputType,inputLabel:a.inputLabel,network:a.network||null,
      status:a.status,durationMs:a.durationMs,json:JSON.stringify(a),session});
  db.prepare(`INSERT INTO events(created_at,event,input_type,network,duration_ms,status,anonymous_session,metadata_json)
    VALUES(?,?,?,?,?,?,?,?)`).run(new Date().toISOString(),"analysis_completed",a.inputType,a.network||null,
    a.durationMs,a.status,session,JSON.stringify(a.metadata||{}));
}

export function logEvent(event:string, session:string, metadata:Record<string,unknown>={}) {
  db.prepare(`INSERT INTO events(created_at,event,anonymous_session,metadata_json) VALUES(?,?,?,?)`)
    .run(new Date().toISOString(),event,session,JSON.stringify(metadata));
}

export function getAnalysis(id:string):Analysis|null {
  const row=db.prepare("SELECT analysis_json FROM analyses WHERE id=?").get(id) as any;
  return row?JSON.parse(row.analysis_json):null;
}
export function listAnalyses(limit=50):Analysis[] {
  const rows=db.prepare("SELECT analysis_json FROM analyses ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
  return rows.map(r=>JSON.parse(r.analysis_json));
}

export function analytics() {
  const q=(sql:string)=> (db.prepare(sql).get() as any).c;
  const total=q("SELECT COUNT(*) c FROM analyses");
  const completed=q("SELECT COUNT(*) c FROM analyses WHERE status='completed'");
  const uniqueUsers=q("SELECT COUNT(DISTINCT anonymous_session) c FROM events WHERE anonymous_session IS NOT NULL");
  const avgMs=q("SELECT COALESCE(AVG(duration_ms),0) c FROM analyses WHERE status='completed'");
  const last24h=q("SELECT COUNT(*) c FROM analyses WHERE created_at >= datetime('now','-1 day')");
  const last7d=q("SELECT COUNT(*) c FROM analyses WHERE created_at >= datetime('now','-7 day')");
  const byInput=db.prepare("SELECT input_type type,COUNT(*) count FROM analyses GROUP BY input_type").all();
  const byNetwork=db.prepare("SELECT COALESCE(network,'n/a') network,COUNT(*) count FROM analyses GROUP BY network ORDER BY count DESC").all();
  const events=db.prepare("SELECT event,COUNT(*) count FROM events GROUP BY event ORDER BY count DESC").all();
  return {totalAnalyses:total,completed,failed:total-completed,uniqueUsers,avgDurationMs:Math.round(avgMs),last24h,last7d,byInput,byNetwork,events};
}

export function saveWatch(name:string,inputType:string,inputLabel:string,network:string|undefined,baseline:Analysis) {
  const result=db.prepare(`INSERT INTO watchlist(created_at,name,input_type,input_label,network,baseline_json)
    VALUES(?,?,?,?,?,?)`).run(new Date().toISOString(),name,inputType,inputLabel,network||null,JSON.stringify(baseline));
  return Number(result.lastInsertRowid);
}
export function listWatch(){return db.prepare("SELECT id,created_at,name,input_type,input_label,network,last_check_at FROM watchlist ORDER BY id DESC").all();}
export function getWatch(id:number){return db.prepare("SELECT * FROM watchlist WHERE id=?").get(id) as any;}
export function updateWatch(id:number,baseline:Analysis){
  db.prepare("UPDATE watchlist SET baseline_json=?,last_check_at=? WHERE id=?").run(JSON.stringify(baseline),new Date().toISOString(),id);
}
