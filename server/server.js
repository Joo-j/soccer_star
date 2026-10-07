'use strict';
// 축구선수 키우기 서버: 계정(닉네임 + 토큰, 다른 기기에서는 복구 코드로 찾기), 세이브 동기화, 랭킹, 같은 세계의 실제 플레이어 목록, 1:1 승부차기, 발롱도르.
// Node 기본 모듈만 쓴다 (http, node:sqlite). 같은 주소에서 게임 파일도 내준다 (로컬 실행·테스트용).
//   PORT=3140 DATA_DIR=./data node server/server.js

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3140;
const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'soccer-star.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    name_lc TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL UNIQUE, recovery TEXT NOT NULL,
    save TEXT, profile TEXT, updated INTEGER NOT NULL, created INTEGER NOT NULL, duel_at INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS elo (name_lc TEXT, period INTEGER, elo REAL, w INTEGER, l INTEGER, PRIMARY KEY (name_lc, period));
  CREATE TABLE IF NOT EXISTS duels (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, a TEXT, b TEXT, data TEXT);
  CREATE TABLE IF NOT EXISTS bd_final (period INTEGER PRIMARY KEY, data TEXT);
  CREATE TABLE IF NOT EXISTS bd_claim (name_lc TEXT, period INTEGER, PRIMARY KEY (name_lc, period));
`);

// 발롱도르 시즌: 3일, 한국 시간 2026-10-01 00:00 시작 (src/data.js 의 BD_EPOCH 와 같아야 한다)
const BD_EPOCH = Date.UTC(2026, 8, 30, 15, 0, 0);
const BD_PERIOD_MS = 3 * 24 * 3600 * 1000;
const periodOf = (t) => Math.floor((t - BD_EPOCH) / BD_PERIOD_MS);
const periodEnd = (p) => BD_EPOCH + (p + 1) * BD_PERIOD_MS;
const NAME_RE = /^[가-힣A-Za-z0-9_]{2,12}$/;

// ───────────────────────── 공통 ─────────────────────────
function send(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  });
  res.end(JSON.stringify(data));
}
class HttpError extends Error { constructor(code, msg, tag) { super(msg); this.code = code; this.tag = tag; } }
async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) { size += c.length; if (size > 2e6) throw new HttpError(413, '데이터가 너무 커요'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, '잘못된 요청이에요'); }
}
function auth(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, '로그인이 필요해요');
  const row = db.prepare('SELECT * FROM accounts WHERE token = ?').get(m[1]);
  if (!row) throw new HttpError(401, '계정을 찾을 수 없어요', 'gone');
  return row;
}
const parseJson = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const profileOf = (row) => ({ ...(parseJson(row.profile, {})), name: row.name, updated: row.updated });

// ───────────────────────── 발롱도르 ─────────────────────────
function bdPoints(bd) {
  if (!bd || !bd.apps) return 0;
  const avg = bd.rs / bd.apps;
  const w = bd.wsum / bd.apps;
  return Math.round((bd.g * 4 + bd.a * 3 + bd.mom * 3 + bd.cs * 2 + Math.max(0, avg - 6) * bd.apps * 2) * w);
}
function standings(period) {
  const rows = db.prepare('SELECT name, profile, updated FROM accounts').all();
  const list = [];
  for (const r of rows) {
    const p = parseJson(r.profile, {});
    if (!p.bd || p.bd.key !== period) continue;
    const pts = bdPoints(p.bd);
    if (pts <= 0) continue;
    list.push({ name: r.name, pts, g: p.bd.g, a: p.bd.a, apps: p.bd.apps, avg: Math.round(p.bd.rs / p.bd.apps * 100) / 100, team: p.teamName, tier: p.tier, pos: p.pos });
  }
  return list.sort((a, b) => b.pts - a.pts);
}
// 끝난 시즌을 확정한다. 세이브를 덮어쓰기 전에 매 요청마다 먼저 부른다
function finalizeEnded() {
  const cur = periodOf(Date.now());
  const last = db.prepare('SELECT MAX(period) AS p FROM bd_final').get().p;
  const from = last == null ? cur - 1 : last + 1;
  for (let p = Math.max(from, cur - 3); p < cur; p++) {
    if (p < 0) continue;
    const top = standings(p).slice(0, 10);
    db.prepare('INSERT OR IGNORE INTO bd_final (period, data) VALUES (?, ?)').run(p, JSON.stringify(top));
  }
}

// ───────────────────────── 승부차기 ─────────────────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pkKick = (kick, keep) => clamp(0.75 + (kick - keep) * 0.006, 0.45, 0.93);
function simShootout(A, B) {
  const kicks = [];
  const sc = [0, 0];
  for (let r = 0; r < 10; r++) {
    for (const side of [0, 1]) {
      const att = side ? B : A, gk = side ? A : B;
      const goal = Math.random() < pkKick(att.kick, gk.keep);
      if (goal) sc[side]++;
      kicks.push({ side, goal });
    }
    if (r >= 4 && sc[0] !== sc[1]) break;
  }
  if (sc[0] === sc[1]) { sc[Math.random() < 0.5 ? 0 : 1]++; kicks.push({ side: sc[0] > sc[1] ? 0 : 1, goal: true, coin: true }); }
  return { kicks, score: sc, winner: sc[0] > sc[1] ? 0 : 1 };
}
function eloRow(nameLc, period) {
  return db.prepare('SELECT * FROM elo WHERE name_lc = ? AND period = ?').get(nameLc, period) || { name_lc: nameLc, period, elo: 1000, w: 0, l: 0 };
}
function saveElo(r) {
  db.prepare('INSERT INTO elo (name_lc, period, elo, w, l) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name_lc, period) DO UPDATE SET elo = excluded.elo, w = excluded.w, l = excluded.l')
    .run(r.name_lc, r.period, r.elo, r.w, r.l);
}

// ───────────────────────── 라우트 ─────────────────────────
const routes = {
  'GET /api/health': () => ({ ok: true, period: periodOf(Date.now()) }),

  'GET /api/nickname': (req, url) => {
    const name = url.searchParams.get('name') || '';
    if (!NAME_RE.test(name)) return { ok: false, reason: '한글·영문·숫자·_ 2~12자' };
    const ex = db.prepare('SELECT 1 FROM accounts WHERE name_lc = ?').get(name.toLowerCase());
    return ex ? { ok: false, reason: '이미 있는 이름이에요' } : { ok: true };
  },

  'POST /api/accounts': async (req) => {
    const { name } = await readBody(req);
    if (!NAME_RE.test(name || '')) throw new HttpError(400, '이름은 한글·영문·숫자·_ 2~12자');
    if (db.prepare('SELECT 1 FROM accounts WHERE name_lc = ?').get(name.toLowerCase())) throw new HttpError(409, '이미 있는 이름이에요');
    const token = crypto.randomBytes(24).toString('base64url');
    const recovery = crypto.randomBytes(4).toString('hex').toUpperCase();
    const t = Date.now();
    db.prepare('INSERT INTO accounts (name_lc, name, token, recovery, updated, created) VALUES (?, ?, ?, ?, ?, ?)').run(name.toLowerCase(), name, token, recovery, t, t);
    return { name, token, recovery };
  },

  'POST /api/recover': async (req) => {
    const { name, code } = await readBody(req);
    const row = db.prepare('SELECT * FROM accounts WHERE name_lc = ?').get(String(name || '').toLowerCase());
    if (!row || row.recovery !== String(code || '').trim().toUpperCase()) throw new HttpError(404, '이름이나 코드가 맞지 않아요');
    return { name: row.name, token: row.token, recovery: row.recovery };
  },

  'GET /api/me': (req) => {
    const row = auth(req);
    return { name: row.name, save: parseJson(row.save), updated: row.updated, recovery: row.recovery };
  },

  'PUT /api/me': async (req) => {
    const row = auth(req);
    const { save, profile } = await readBody(req);
    if (!save || typeof save !== 'object') throw new HttpError(400, '세이브가 없어요');
    const t = Date.now();
    db.prepare('UPDATE accounts SET save = ?, profile = ?, updated = ? WHERE name_lc = ?').run(JSON.stringify(save), JSON.stringify(profile || {}), t, row.name_lc);
    return { ok: true, updated: t };
  },

  'GET /api/ranking': (req, url) => {
    const sort = url.searchParams.get('sort') || 'value';
    const period = periodOf(Date.now());
    const rows = db.prepare('SELECT name, name_lc, profile, updated FROM accounts WHERE profile IS NOT NULL').all();
    const elo = Object.fromEntries(db.prepare('SELECT * FROM elo WHERE period = ?').all(period).map((r) => [r.name_lc, r]));
    let list = rows.map((r) => {
      const p = parseJson(r.profile, {});
      const e = elo[r.name_lc] || { elo: 1000, w: 0, l: 0 };
      return {
        name: r.name, pos: p.pos, style: p.style, title: p.title, ovr: p.ovr || 0, age: p.age, tier: p.tier, teamName: p.teamName,
        value: p.value || 0, fame: p.fame || 0, goals: p.goals || 0, assists: p.assists || 0, apps: p.apps || 0,
        awards: p.awards || 0, gen: p.gen || 1, retired: !!p.retired, elo: Math.round(e.elo), w: e.w, l: e.l, legends: p.legends || [],
      };
    });
    const key = { value: 'value', ovr: 'ovr', fame: 'fame', goals: 'goals', elo: 'elo' }[sort] || 'value';
    if (key === 'elo') list = list.filter((x) => x.w + x.l > 0);
    list.sort((a, b) => b[key] - a[key]);
    return { sort: key, list: list.slice(0, 100), period };
  },

  // 같은 세계의 실제 플레이어 (최근 7일 안에 접속한 현역)
  'GET /api/world': () => {
    const since = Date.now() - 7 * 24 * 3600 * 1000;
    const rows = db.prepare('SELECT name, profile FROM accounts WHERE updated > ? AND profile IS NOT NULL ORDER BY updated DESC LIMIT 800').all(since);
    return {
      list: rows.map((r) => { const p = parseJson(r.profile, {}); return p.teamId && !p.retired ? { name: r.name, teamId: p.teamId, pos: p.pos, ovr: p.ovr, age: p.age } : null; }).filter(Boolean),
    };
  },

  'POST /api/duels': async (req) => {
    const me = auth(req);
    const { target } = await readBody(req);
    const t = Date.now();
    if (t - (me.duel_at || 0) < 5000) throw new HttpError(429, '승부차기는 5초에 한 번 할 수 있어요');
    const opp = db.prepare('SELECT * FROM accounts WHERE name_lc = ?').get(String(target || '').toLowerCase());
    if (!opp) throw new HttpError(404, '상대를 찾을 수 없어요');
    if (opp.name_lc === me.name_lc) throw new HttpError(400, '자기 자신과는 할 수 없어요');
    const pa = parseJson(me.profile, {}), pb = parseJson(opp.profile, {});
    if (!pa.duel || !pb.duel) throw new HttpError(400, '아직 능력치가 올라가지 않았어요');
    const r = simShootout(pa.duel, pb.duel);
    const period = periodOf(t);
    const ea = eloRow(me.name_lc, period), eb = eloRow(opp.name_lc, period);
    const exp = 1 / (1 + Math.pow(10, (eb.elo - ea.elo) / 400));
    const delta = Math.round(32 * ((r.winner === 0 ? 1 : 0) - exp));
    ea.elo += delta; eb.elo -= delta;
    if (r.winner === 0) { ea.w++; eb.l++; } else { ea.l++; eb.w++; }
    saveElo(ea); saveElo(eb);
    db.prepare('UPDATE accounts SET duel_at = ? WHERE name_lc = ?').run(t, me.name_lc);
    const duel = { at: t, a: me.name, b: opp.name, ...r, delta, eloA: Math.round(ea.elo), eloB: Math.round(eb.elo), posA: pa.pos, posB: pb.pos };
    db.prepare('INSERT INTO duels (at, a, b, data) VALUES (?, ?, ?, ?)').run(t, me.name_lc, opp.name_lc, JSON.stringify(duel));
    return { duel };
  },

  'GET /api/duels/inbox': (req) => {
    const me = auth(req);
    const rows = db.prepare('SELECT data FROM duels WHERE b = ? ORDER BY id DESC LIMIT 20').all(me.name_lc);
    return { list: rows.map((r) => parseJson(r.data)) };
  },

  'GET /api/ballondor': (req) => {
    const t = Date.now();
    const period = periodOf(t);
    const finals = db.prepare('SELECT * FROM bd_final ORDER BY period DESC LIMIT 10').all().map((r) => ({ period: r.period, top: parseJson(r.data, []) }));
    let reward = null;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (m) {
      const me = db.prepare('SELECT name_lc FROM accounts WHERE token = ?').get(m[1]);
      if (me) {
        for (const f of finals) {
          const rank = f.top.findIndex((x) => x.name.toLowerCase() === me.name_lc) + 1;
          if (rank && !db.prepare('SELECT 1 FROM bd_claim WHERE name_lc = ? AND period = ?').get(me.name_lc, f.period)) { reward = { period: f.period, rank }; break; }
        }
      }
    }
    return { period, endsAt: periodEnd(period), standings: standings(period).slice(0, 30), finals, reward };
  },

  'POST /api/ballondor/ack': async (req) => {
    const me = auth(req);
    const { period } = await readBody(req);
    const f = db.prepare('SELECT data FROM bd_final WHERE period = ?').get(Number(period));
    if (!f) throw new HttpError(404, '확정되지 않은 시즌이에요');
    const rank = parseJson(f.data, []).findIndex((x) => x.name.toLowerCase() === me.name_lc) + 1;
    if (!rank) throw new HttpError(400, '순위에 없어요');
    const r = db.prepare('INSERT OR IGNORE INTO bd_claim (name_lc, period) VALUES (?, ?)').run(me.name_lc, Number(period));
    if (!r.changes) throw new HttpError(409, '이미 받았어요');
    return { period: Number(period), rank };
  },
};

// ───────────────────────── 정적 파일 ─────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const ok = p === '/index.html' || p === '/style.css' || p.startsWith('/src/') || p.startsWith('/assets/');
  const file = path.join(ROOT, p);
  if (!ok || !file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not Found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
  const fn = routes[`${req.method} ${url.pathname}`];
  if (!fn) return send(res, 404, { error: 'Not Found' });
  try {
    finalizeEnded();
    send(res, 200, await fn(req, url));
  } catch (e) {
    if (e instanceof HttpError) send(res, e.code, { error: e.message, code: e.tag });
    else { console.error(e); send(res, 500, { error: '서버 오류' }); }
  }
});
server.listen(PORT, () => console.log(`축구선수 키우기 서버: http://localhost:${PORT}`));
