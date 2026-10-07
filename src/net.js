'use strict';
// 서버 통신: 계정(닉네임 + 토큰), 세이브 동기화, 랭킹, 같은 세계의 실제 플레이어, 승부차기, 발롱도르.
// 세이브는 이 기기에 먼저 쓰고 30초마다 서버에 올린다. 서버에 못 닿아도 게임은 계속된다.

const Net = (() => {
  const DEFAULT_SERVER = 'https://soccer-star.onrender.com';
  const qs = new URLSearchParams(location.search).get('server');
  const sameOrigin = /^https?:$/.test(location.protocol) && /localhost|127\.0\.0\.1|onrender\.com/.test(location.hostname) ? location.origin : null;
  const SERVER = (qs || window.SOCCER_SERVER || sameOrigin || DEFAULT_SERVER).replace(/\/+$/, '');
  const ACC_KEY = 'soccer-star-accounts';
  const SYNC_EVERY = 30000;
  let status = 'idle';
  let lastSent = '';
  let world = [];
  let worldAt = 0;
  const onStatus = [];

  function setStatus(s) { status = s; onStatus.forEach((f) => f(s)); }

  async function api(method, p, body, { timeout = 20000, keepalive = false, auth = true } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const headers = { 'Content-Type': 'application/json' };
      const tok = auth && activeToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const res = await fetch(SERVER + p, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, keepalive });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(data.error || `서버 오류 (${res.status})`); e.status = res.status; e.code = data.code; throw e; }
      return data;
    } catch (e) {
      if (e.status) throw e;
      const err = new Error(e.name === 'AbortError' ? '서버가 응답하지 않아요' : '서버에 연결할 수 없어요');
      err.status = 0;
      throw err;
    } finally { clearTimeout(timer); }
  }

  // ── 이 기기의 계정 목록 { active, list: { 이름: { token, recovery } } }
  function accounts() { try { return JSON.parse(localStorage.getItem(ACC_KEY)) || { active: null, list: {} }; } catch { return { active: null, list: {} }; } }
  function setAccounts(a) { try { localStorage.setItem(ACC_KEY, JSON.stringify(a)); } catch {} }
  function activeToken() { const a = accounts(); return a.active && a.list[a.active] ? a.list[a.active].token : null; }
  function activeName() { return accounts().active; }
  function remember(name, token, recovery) { const a = accounts(); a.list[name] = { token, recovery }; a.active = name; setAccounts(a); }
  function switchTo(name) { const a = accounts(); if (a.list[name]) { a.active = name; setAccounts(a); } }
  function forget(name) { const a = accounts(); delete a.list[name]; if (a.active === name) a.active = null; setAccounts(a); }

  const checkName = (name) => api('GET', `/api/nickname?name=${encodeURIComponent(name)}`, null, { auth: false });
  async function createAccount(name) { const r = await api('POST', '/api/accounts', { name }, { auth: false, timeout: 60000 }); remember(r.name, r.token, r.recovery); return r; }
  async function recover(name, code) { const r = await api('POST', '/api/recover', { name, code }, { auth: false, timeout: 60000 }); remember(r.name, r.token, r.recovery); return r; }
  const loadRemote = () => api('GET', '/api/me', null, { timeout: 60000 });

  function duelStats(s) {
    const st = effStats(s);
    const shotLv = Math.max(0, ...Object.entries(s.skills).filter(([id]) => SKILL_BY_ID[id].kind === 'shot').map(([, l]) => l));
    const kick = st.sho * 0.8 + st.phy * 0.1 + shotLv * 1.5;
    const keep = s.pos === 'GK' ? st.def + (s.skills.pksave || 0) * 2 : st.def * 0.45 + st.phy * 0.1;
    return { kick: Math.round(kick), keep: Math.round(keep) };
  }
  function profile(s = S) {
    const team = s.teamId ? TEAM_BY_ID[s.teamId] : null;
    return {
      pos: s.pos, style: s.style ? styleOf(s).name : null, title: s.title, ovr: myOvr(s), age: s.age,
      tier: team ? team.tier : null, teamId: s.teamId, teamName: team ? team.name : null,
      value: marketValue(s), fame: Math.round(s.fame), goals: s.career.goals, assists: s.career.assists, apps: s.career.apps,
      awards: s.career.awards.length + s.career.trophies.length, gen: s.gen, retired: s.phase === 'retired',
      legends: (s.legends || []).map((l) => ({ gen: l.gen, pos: l.pos, goals: l.goals, apps: l.apps, title: l.title })),
      bd: s.bd, duel: duelStats(s),
    };
  }

  async function sync(force = false) {
    if (!S || !activeToken() || activeName() !== S.name) return;
    const body = { save: S, profile: profile() };
    const str = JSON.stringify(body);
    if (!force && str === lastSent) return;
    setStatus('syncing');
    try {
      await api('PUT', '/api/me', body, { keepalive: str.length < 60000 });
      lastSent = str;
      setStatus('online');
    } catch (e) {
      setStatus(e.code === 'gone' ? 'gone' : 'offline');
    }
  }
  setInterval(() => sync(), SYNC_EVERY);

  async function refreshWorld(force = false) {
    if (!force && Date.now() - worldAt < 120000) return world;
    try { world = (await api('GET', '/api/world', null, { auth: false })).list; worldAt = Date.now(); } catch {}
    return world;
  }
  setInterval(() => refreshWorld(), 120000);
  const realsOn = (teamId) => world.filter((p) => p.teamId === teamId && (!S || p.name !== S.name));

  return {
    SERVER, get status() { return status; }, onStatus: (f) => onStatus.push(f),
    accounts, activeName, activeToken, switchTo, forget,
    checkName, createAccount, recover, loadRemote, sync, profile, duelStats,
    refreshWorld, realsOn, get world() { return world; },
    ranking: (sort) => api('GET', `/api/ranking?sort=${sort}`, null, { auth: false }),
    duel: (target) => api('POST', '/api/duels', { target }),
    inbox: () => api('GET', '/api/duels/inbox'),
    ballondor: () => api('GET', '/api/ballondor'),
    ackBd: (period) => api('POST', '/api/ballondor/ack', { period }),
  };
})();
