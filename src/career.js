'use strict';
// 커리어 진행: 시즌 일정, 출전(연속 경기) 루프, 경기 결과 반영, 시즌 결산·개인상·이적 제의·연봉 협상·은퇴.
// tick(t) 하나가 모든 시간 흐름을 처리한다 — 앱을 꺼 둔 시간도 같은 함수로 따라잡는다.

// ───────────────────────── 시즌 ─────────────────────────
function roundRobin(ids, rounds) {
  const n = ids.length;
  const arr = ids.slice();
  const days = [];
  for (let r = 0; r < n - 1; r++) {
    const day = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      // 고정 팀(0번)은 라운드마다, 나머지는 자리(i)가 바뀔 때마다 홈·원정이 번갈아 든다
      day.push((i === 0 ? r : i) % 2 ? [a, b] : [b, a]);
    }
    days.push(day);
    arr.splice(1, 0, arr.pop());
  }
  if (rounds === 2) days.push(...days.map((d) => d.map(([a, b]) => [b, a])));
  return days;
}

function newSeason(teamId) {
  const team = TEAM_BY_ID[teamId];
  const ids = teamsOfTier(team.tier).map((t) => t.id);
  const shuffled = ids.slice().sort(() => Math.random() - 0.5);
  const ai = {};
  for (const id of ids) for (const st of aiStarsOf(id)) ai[st.key] = { name: st.name, teamId: id, pos: st.pos, g: 0, a: 0 };
  S.teamId = teamId;
  // 시즌 번호는 무소속(시즌 없음)을 거쳐도 이어서 센다
  S.seasonNo = (S.seasonNo || (S.season ? S.season.no : 0)) + 1;
  S.season = {
    no: S.seasonNo,
    tier: team.tier, teamId,
    fixtures: roundRobin(shuffled, LEAGUES[team.tier].rounds),
    md: 0,
    table: Object.fromEntries(ids.map((id) => [id, { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }])),
    ai,
    my: { apps: 0, g: 0, a: 0, rs: 0, mom: 0, cs: 0, tk: 0, sv: 0 },
    done: false,
  };
  S.pendingEnd = null;
}

function sortedTable(season = S.season) {
  return Object.entries(season.table)
    .map(([id, r]) => ({ id, ...r, gd: r.gf - r.ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}
function myFixture(md = S.season.md) {
  const day = S.season.fixtures[md];
  if (!day) return null;
  const pair = day.find((p) => p.includes(S.season.teamId));
  const home = pair[0] === S.season.teamId;
  return { md, home, oppId: home ? pair[1] : pair[0] };
}
const seasonLen = () => S.season.fixtures.length;

// ───────────────────────── 출전 ─────────────────────────
function canStartRun(t = Date.now()) {
  if (S.free) return '무소속 — 경기에 나갈 팀이 없어요';
  if (!S.season || S.season.done || S.pendingEnd) return '시즌 결산을 먼저 확인해 주세요';
  if (S.mode !== 'home') return '이미 경기에 나가 있어요';
  if (injured(t)) return `부상 회복 중 (${fmtSec((S.injury.until - t) / 1000)})`;
  if (S.stamina < staminaCost()) return '스태미나가 부족해요';
  return null;
}
function startRun() {
  if (canStartRun()) return false;
  S.mode = 'run';
  S.run = { phase: 'travel', t0: Date.now(), stop: false, played: 0, match: null };
  hooks.changed();
  return true;
}
function stopRun() {
  if (S.mode !== 'run') return;
  if (S.run.phase === 'travel') { S.run.phase = 'back'; S.run.t0 = Date.now(); }
  else S.run.stop = true;
  hooks.changed();
}

function startMatch(t0) {
  const fx = myFixture();
  const myTeam = TEAM_BY_ID[S.season.teamId];
  const oppTeam = TEAM_BY_ID[fx.oppId];
  const me = {
    name: S.name, pos: S.pos, st: effStats(), skills: S.skills, style: S.style,
    staminaRatio: S.stamina / stamMax(), injury: rollInjury(S.stamina < staminaCost() * 2),
  };
  const reals = (typeof Net !== 'undefined' ? Net.realsOn(fx.oppId) : []);
  const res = simMatch({ me, myTeam, oppTeam, home: fx.home, reals, stars: S.season.ai });
  const others = [];
  for (const [h, a] of S.season.fixtures[fx.md]) {
    if (h === S.season.teamId || a === S.season.teamId) continue;
    const sc = quickSim(TEAM_BY_ID[h], TEAM_BY_ID[a]);
    const goals = [];
    for (let i = 0; i < sc[0]; i++) goals.push(allocGoal(h));
    for (let i = 0; i < sc[1]; i++) goals.push(allocGoal(a));
    others.push({ h, a, sc, goals });
  }
  S.run.phase = 'match';
  S.run.match = { ...fx, t0, res, others };
}

function addTable(id, gf, ga) {
  const r = S.season.table[id];
  r.p++; r.gf += gf; r.ga += ga;
  if (gf > ga) { r.w++; r.pts += 3; } else if (gf === ga) { r.d++; r.pts += 1; } else r.l++;
}
function bdKey(t = Date.now()) { return Math.floor((t - BD_EPOCH) / BD_PERIOD_MS); }

function applyMatch(endT) {
  const { md, home, oppId, res, others } = S.run.match;
  const sea = S.season;
  const me = res.me;
  const tier = sea.tier;
  const lg = LEAGUES[tier];
  // 리그 표
  addTable(sea.teamId, res.score[0], res.score[1]);
  addTable(oppId, res.score[1], res.score[0]);
  for (const o of others) { addTable(o.h, o.sc[0], o.sc[1]); addTable(o.a, o.sc[1], o.sc[0]); }
  // AI 기록
  const credit = (key, f) => { if (key && sea.ai[key]) sea.ai[key][f]++; };
  for (const s of res.scorers) { if (s.key !== 'me') credit(s.key, 'g'); if (s.assist !== 'me') credit(s.assist, 'a'); }
  for (const o of others) for (const g of o.goals) { credit(g.scorer, 'g'); credit(g.assist, 'a'); }
  // 내 기록
  const my = sea.my;
  my.apps++; my.g += me.g; my.a += me.a; my.rs += me.rating; my.tk += me.tk; my.sv += me.sv;
  if (me.mom) my.mom++;
  if (me.cs) my.cs++;
  const c = S.career;
  c.apps++; c.goals += me.g; c.assists += me.a; if (me.mom) c.mom++; if (me.cs) c.cs++;
  const key = bdKey(endT);
  if (!S.bd || S.bd.key !== key) S.bd = { key, apps: 0, g: 0, a: 0, rs: 0, mom: 0, cs: 0, wsum: 0 };
  S.bd.apps++; S.bd.g += me.g; S.bd.a += me.a; S.bd.rs += me.rating; S.bd.mom += me.mom ? 1 : 0; S.bd.cs += me.cs ? 1 : 0; S.bd.wsum += lg.weight;

  // 보상
  const cost = staminaCost();
  S.stamina = Math.max(0, S.stamina - cost);
  const pay = S.phase === 'school'
    ? lg.pocket + Math.max(0, me.rating - 6) * 8
    : (S.contract ? S.contract.salary / seasonLen() : 0) * (res.res === 'W' ? 1.15 : 1);
  const bonus = (me.g * 0.04 + me.a * 0.025) * (S.contract ? S.contract.salary : 200) / 10;
  const spon = sponsorPay();
  const money = Math.round(pay + bonus + spon);
  S.money += money;
  addExp((20 + Math.max(0, me.rating - 5) * 12 + me.g * 10 + me.a * 6) * (1 + tier * 0.35));
  const notes = 1 + (me.rating >= 7.5 ? 1 : 0) + (me.mom ? 1 : 0) + (tier >= 3 ? 1 : 0);
  S.notes += notes;
  const fameBase = [15, 60, 260, 1200, 7000][tier];
  const fame = fameBase * Math.max(0.2, me.rating - 5) * (1 + me.g * 0.5 + me.a * 0.3) * (me.mom ? 1.5 : 1) * (1 + Math.log10(1 + S.fame) / 10);
  addFame(fame);
  let gear = null, gearMsg = null;
  if (chance(0.14 + (me.mom ? 0.15 : 0))) { gear = makeGear(rollGrade(tier)); gearMsg = addGear(gear); }
  if (me.injury) {
    S.injury = { name: me.injury.name, until: endT + me.injury.sec * 1000 };
    hooks.banner('🚑 부상', `${me.injury.name} — ${fmtSec(me.injury.sec)} 동안 출전할 수 없어요`);
  }
  const opp = TEAM_BY_ID[oppId];
  S.reports.unshift({
    t: endT, season: sea.no, md: md + 1, tier, home, opp: opp.name, oppId, score: res.score, res: res.res,
    rating: me.rating, g: me.g, a: me.a, tk: me.tk, sv: me.sv, mom: me.mom, injury: me.injury && me.injury.name,
    money, fame: Math.round(fame), notes, gear: gear && !gearMsg ? { name: gear.name, grade: gear.grade } : null,
    log: res.events.filter((e) => e.text && (e.who === 'me' || e.type === 'goal' || e.type === 'injury' || e.type === 'end')).map((e) => `${e.min}' ${e.text}`),
  });
  S.reports.length = Math.min(S.reports.length, 30);
  S.unread = (S.unread || 0) + 1;
  sea.md++;
  S.run.played++;
  if (sea.md >= seasonLen()) finishSeason();
}

// ───────────────────────── 시즌 결산 ─────────────────────────
function finishSeason() {
  const sea = S.season;
  sea.done = true;
  const table = sortedTable();
  const rank = table.findIndex((r) => r.id === sea.teamId) + 1;
  const my = sea.my;
  const avg = my.apps ? my.rs / my.apps : 0;
  const lg = LEAGUES[sea.tier];
  const ai = Object.values(sea.ai);
  const topBy = (f) => ai.slice().sort((a, b) => b[f] - a[f])[0];
  const awards = [];
  const won = (name, money, fame) => { awards.push({ name, me: true, money, fame }); };
  const topG = topBy('g'), topA = topBy('a');
  const salaryRef = Math.max(200, lg.salary);
  if (my.g > 0 && my.g >= topG.g) won(`${lg.short} 득점왕`, salaryRef * 0.1, 1);
  else awards.push({ name: `${lg.short} 득점왕`, who: `${topG.name} (${TEAM_BY_ID[topG.teamId].name})`, val: `${topG.g}골` });
  if (my.a > 0 && my.a >= topA.a) won(`${lg.short} 도움왕`, salaryRef * 0.08, 1);
  else awards.push({ name: `${lg.short} 도움왕`, who: `${topA.name} (${TEAM_BY_ID[topA.teamId].name})`, val: `${topA.a}도움` });
  const mvpMe = my.apps >= seasonLen() * 0.6 && avg >= 7.3 && (rank <= 3 || avg >= 7.8);
  if (mvpMe) won(`${lg.short} MVP`, salaryRef * 0.15, 1.5);
  else { const champStar = sea.ai[table[0].id + (chance(0.6) ? ':fw' : ':mf')]; awards.push({ name: `${lg.short} MVP`, who: `${champStar.name} (${TEAM_BY_ID[table[0].id].name})` }); }
  if (my.apps >= seasonLen() * 0.5 && avg >= 7.0) won(`${lg.short} 베스트 11`, salaryRef * 0.04, 0.6);
  if (S.phase === 'pro' && S.age <= 21 && avg >= 6.9) won(`${lg.short} 영플레이어상`, salaryRef * 0.05, 0.8);
  if (rank === 1) won(`🏆 ${lg.name} 우승`, salaryRef * 0.2, 2);
  let rewardMoney = 0, rewardFame = 0;
  for (const a of awards.filter((x) => x.me)) {
    rewardMoney += Math.round(a.money);
    rewardFame += [80, 400, 2500, 15000, 90000][sea.tier] * a.fame;
    if (a.name.includes('우승')) S.career.trophies.push(`${sea.no}시즌 ${lg.name}`);
    else S.career.awards.push(`${sea.no}시즌 ${a.name}`);
  }
  S.money += rewardMoney;
  addFame(rewardFame);
  S.career.history.push({ no: sea.no, age: S.age, tier: sea.tier, team: TEAM_BY_ID[sea.teamId].name, apps: my.apps, g: my.g, a: my.a, cs: my.cs, avg: Math.round(avg * 100) / 100, rank });

  S.age++;
  const pe = {
    no: sea.no, tier: sea.tier, teamId: sea.teamId, rank, avg, my: { ...my },
    table: table.map((r) => ({ id: r.id, p: r.p, w: r.w, d: r.d, l: r.l, gd: r.gd, pts: r.pts })),
    awards, rewardMoney, rewardFame: Math.round(rewardFame),
    schoolNext: false, draft: null, market: null,
    canRetire: S.phase === 'pro' && S.age >= 34, mustRetire: S.age >= 40,
  };
  if (S.phase === 'school' && S.grade < 3) pe.schoolNext = true;
  else if (S.phase === 'school') pe.draft = runDraft();
  else {
    if (S.contract) S.contract.years--;
    pe.market = openMarket(avg, rank === 1);
  }
  S.pendingEnd = pe;
  S.run.stop = true;
  hooks.banner(`📋 ${sea.no}시즌 종료`, `${lg.name} ${rank}위 · ${my.g}골 ${my.a}도움 · 평점 ${avg.toFixed(2)}`);
}

// ───────────────────────── 드래프트 ─────────────────────────
// 고3 시즌이 끝나면 동기 80명 중 고교 3년 성적으로 순위가 매겨진다.
// 지명 순서: 1라운드 1~10 1부 · 11~20 2부 · 21~30 3부 (각 리그 약팀부터), 2라운드 31~40 3부. 41위부터는 미지명.
const DRAFT_CLASS = 80;
const DRAFT_MEAN = 46, DRAFT_SD = 7;
// 포지션마다 평점·기록이 나오는 정도가 달라서 보정한다 (평범하게 키운 고3이 어느 포지션이든 동기 20위권)
const AVG_ADJ = { FW: 0, MF: 0.1, DF: 0.25, GK: 0.3 };
const DRAFT_ADJ = { FW: -3, MF: 2.5, DF: 4.5, GK: 6 };
function schoolStats(s = S) {
  const rows = s.career.history.filter((h) => h.tier === 0).map((h) => ({ apps: h.apps, g: h.g, a: h.a, cs: h.cs || 0, avg: h.avg }));
  if (s.phase === 'school' && s.season && !s.season.done && s.season.my.apps) {
    const m = s.season.my;
    rows.push({ apps: m.apps, g: m.g, a: m.a, cs: m.cs, avg: m.rs / m.apps });
  }
  const sum = (f) => rows.reduce((x, r) => x + r[f], 0);
  const apps = sum('apps');
  const awards = s.career.awards.filter((x) => x.includes('고교')).length + s.career.trophies.filter((x) => x.includes('고교')).length;
  return { apps, g: sum('g'), a: sum('a'), cs: sum('cs'), avg: apps ? rows.reduce((x, r) => x + r.avg * r.apps, 0) / apps : 0, awards };
}
// project: 아직 고교 중이면 남은 경기와 성장을 어림해서 3년 기준으로 환산 (스카우트 예상용)
function draftScore(s = S, project = false) {
  const st = schoolStats(s);
  const full = 27;
  const per = project && st.apps ? full / Math.max(st.apps, 1) : 1;
  const prod = { FW: st.g * 0.35 + st.a * 0.2, MF: st.g * 0.25 + st.a * 0.3, DF: st.cs * 0.35 + st.g * 0.4, GK: st.cs * 0.45 }[s.pos] * per;
  const grow = project ? Math.max(0, (full - st.apps) / 9) * 1.7 : 0; // 고교 한 시즌에 OVR 약 1.7 성장
  return myOvr(s) + grow + (st.apps ? (st.avg + AVG_ADJ[s.pos] - 6.5) * 8 : 0) + prod + st.awards * 3 + Math.log10(s.fame + 1) * 1.2 + DRAFT_ADJ[s.pos];
}
function gauss() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); }
function normCdf(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
function draftOrder() {
  const asc = (tier) => teamsOfTier(tier).slice().sort((a, b) => a.r - b.r).map((t) => t.id);
  return [...asc(3), ...asc(2), ...asc(1), ...asc(1)];
}
const DRAFT_PICKS = 40;
function draftGrade(rank) { return rank <= 3 ? 'S' : rank <= 10 ? 'A' : rank <= 20 ? 'B' : rank <= 30 ? 'C' : rank <= 40 ? 'D' : 'F'; }
function pickInfo(no) {
  const order = draftOrder();
  if (no > order.length) return null;
  const team = TEAM_BY_ID[order[no - 1]];
  return { no, round: no <= 30 ? 1 : 2, teamId: team.id, tier: team.tier };
}
// 스카우트 예상 (고교 중 언제든)
function scoutReport(s = S) {
  const sc = draftScore(s, true);
  const rank = Math.max(1, Math.round(1 + (DRAFT_CLASS - 1) * (1 - normCdf((sc - DRAFT_MEAN) / DRAFT_SD))));
  return { score: sc, rank, grade: draftGrade(rank), pick: pickInfo(rank) };
}
function rookieContract(no) {
  const p = pickInfo(no);
  const inBlock = (no - 1) % 10;
  const salary = Math.round(LEAGUES[p.tier].salary * (0.75 - inBlock * 0.03) / 100) * 100;
  return { teamId: p.teamId, salary, years: p.round === 1 ? 3 : 2, bonus: Math.round(10000 * Math.pow(0.88, no - 1) / 10) * 10 };
}
function runDraft() {
  const cls = [];
  for (let i = 0; i < DRAFT_CLASS - 1; i++) {
    const school = pick(teamsOfTier(0)).name;
    const pos = pick(['FW', 'FW', 'MF', 'MF', 'DF', 'DF', 'GK']);
    cls.push({ name: KR_FAMILY[Math.floor(Math.random() * KR_FAMILY.length)] + pick(KR_GIVEN), pos, school, score: DRAFT_MEAN + gauss() * DRAFT_SD });
  }
  const my = draftScore();
  cls.push({ me: true, name: S.name, pos: S.pos, school: TEAM_BY_ID[S.teamId].name, score: my });
  cls.sort((a, b) => b.score - a.score);
  const rank = cls.findIndex((x) => x.me) + 1;
  const order = draftOrder();
  const picks = order.map((teamId, i) => ({ no: i + 1, round: i < 30 ? 1 : 2, teamId, name: cls[i].name, pos: cls[i].pos, school: cls[i].school, me: !!cls[i].me }));
  const myPick = rank <= order.length ? rank : null;
  return { picks, rank, size: DRAFT_CLASS, grade: draftGrade(rank), myPick, contract: myPick ? rookieContract(myPick) : null, stats: schoolStats() };
}

// ───────────────────────── 이적시장 ─────────────────────────
// 시즌이 끝날 때마다 열린다. 계약이 끝났으면 재계약·다른 팀 제의 중에 고르고, 아무 제의도 없으면 방출(무소속).
// 계약 중이면 다른 팀 영입 제의만 오고, 거절하고 남을 수 있다.
const FA_WINDOW_SEC = 900; // 무소속일 때 다음 이적시장까지
// 어린 선수는 잠재력을 쳐 준다 (23세 미만 한 살마다 +2)
const youthBonus = () => Math.max(0, 23 - S.age) * 2;
function marketScore(avg, champion) {
  return myOvr() + youthBonus() + (avg ? (avg + AVG_ADJ[S.pos] - 6.5) * 4 : 0) + Math.log10(S.fame + 1) * 0.8 + (champion ? 2 : 0) - Math.max(0, S.age - 32) * 1.5;
}
function openMarket(avg, champion, { free = false } = {}) {
  const o = myOvr();
  const score = marketScore(avg, champion);
  const cur = S.teamId ? TEAM_BY_ID[S.teamId] : null;
  const under = !free && !!(S.contract && S.contract.years > 0 && cur);
  const offers = [];
  if (cur && !under && !free) {
    const p = clamp(0.65 + (score - cur.r) * 0.06 + (avg + AVG_ADJ[S.pos] - 6.5) * 0.3, 0.04, 0.97);
    if (chance(p)) offers.push({ ...makeOffer(cur, o), renew: true });
  }
  // 팀마다 나를 원할 확률: 내 수준이 팀 전력과 비슷하거나 조금 높을 때 가장 크다
  for (let t = 1; t <= 4; t++) for (const team of teamsOfTier(t)) {
    if (cur && team.id === cur.id) continue;
    if (under && team.r <= cur.r) continue;
    const gap = score - team.r;
    let p = 0.32 * Math.exp(-Math.pow((gap - 2) / 6, 2));
    if (under) p *= 0.6;
    if (free) p *= 0.7;
    if (chance(p)) offers.push({ ...makeOffer(team, o), fee: under ? Math.round(marketValue() * 0.6 / 100) * 100 : 0 });
  }
  offers.sort((a, b) => (b.renew ? 1 : 0) - (a.renew ? 1 : 0) || TEAM_BY_ID[b.teamId].tier - TEAM_BY_ID[a.teamId].tier || b.salary - a.salary);
  return { offers: offers.slice(0, 6), under, released: !under && offers.length === 0 };
}
function makeOffer(team, o) {
  const lg = LEAGUES[team.tier];
  const base = lg.salary * clamp(1 + (o - team.r) * 0.06, 0.4, 4);
  const salary = Math.round(base * (1 + S.bld.agency * 0.05) * (1 + Math.log10(S.fame + 1) / 25) / 100) * 100;
  return { teamId: team.id, salary: Math.max(100, salary), years: 1 + Math.floor(Math.random() * 4), negotiated: false };
}
function offersNow() {
  if (S.pendingEnd && S.pendingEnd.market) return S.pendingEnd.market.offers;
  if (S.free && S.free.market) return S.free.market;
  return [];
}
// pct: 0.15 / 0.3 → 성공하면 연봉 인상, 실패하면 원래 조건만 남는다
function negotiate(i, pct) {
  const of = offersNow()[i];
  if (!of || of.negotiated) return null;
  of.negotiated = true;
  const p = clamp((pct <= 0.15 ? 0.8 : 0.5) + S.bld.agency * 0.04 + (myOvr() - TEAM_BY_ID[of.teamId].r) * 0.01, 0.1, 0.95);
  const ok = chance(p);
  if (ok) of.salary = Math.round(of.salary * (1 + pct) / 100) * 100;
  hooks.changed();
  return ok;
}
function signContract(of, how) {
  const from = S.teamId;
  const t = TEAM_BY_ID[of.teamId];
  S.phase = 'pro';
  S.free = null;
  S.contract = { salary: of.salary, years: of.years };
  if (how === 'draft') hooks.banner(`🎓 ${t.name} 입단`, `${LEAGUES[t.tier].name} · 계약금 ${fmtMoney(of.bonus)} · 연봉 ${fmtMoney(of.salary)} · ${of.years}년`);
  else if (from === of.teamId) hooks.banner(`✍️ ${t.name} 재계약`, `연봉 ${fmtMoney(of.salary)} · ${of.years}년`);
  else hooks.banner(`✈️ ${t.name} ${how === 'free' ? '입단' : '이적'}`, `${LEAGUES[t.tier].name} · 연봉 ${fmtMoney(of.salary)} · ${of.years}년 계약`);
  newSeason(of.teamId);
}
function becomeFree(reason) {
  S.phase = 'pro';
  S.teamId = null;
  S.season = null;
  S.contract = null;
  S.pendingEnd = null;
  S.free = { since: Date.now(), window: Date.now() + FA_WINDOW_SEC * 1000, market: null, tryOffer: null, reason };
  hooks.banner('📭 무소속', `${reason} — 개인 훈련을 하며 입단 테스트나 다음 이적시장을 노려 보세요`);
}
function resolveSeason(choice) {
  const pe = S.pendingEnd;
  if (!pe) return;
  if (choice.type === 'retire') { retire(); return; }
  if (pe.mustRetire) return;
  if (choice.type === 'school') { S.grade++; newSeason(S.teamId); }
  else if (choice.type === 'draft') {
    const d = pe.draft;
    if (d.contract) {
      S.money += d.contract.bonus;
      S.career.draft = { pick: d.myPick, round: d.myPick <= 30 ? 1 : 2, teamId: d.contract.teamId, rank: d.rank };
      signContract(d.contract, 'draft');
    } else {
      S.career.draft = { pick: null, rank: d.rank };
      becomeFree('드래프트 미지명');
    }
  } else if (choice.type === 'stay') newSeason(S.teamId);
  else if (choice.type === 'release') becomeFree('계약 만료 후 제의 없음');
  else if (choice.type === 'offer') signContract(pe.market.offers[choice.i], 'offer');
  hooks.changed();
}

// ───────────────────────── 무소속 ─────────────────────────
const TRYOUT_STAMINA = 30;
function tryoutChance(tier) {
  const avgR = teamsOfTier(tier).reduce((a, t) => a + t.r, 0) / 10;
  return clamp(0.55 + (tier === 1 ? 0.15 : 0) + (myOvr() + youthBonus() - avgR) * 0.035, 0.03, 0.9); // 3부는 유망주에게 문이 넓다
}
function canTryout(tier, t = Date.now()) {
  if (!S.free) return '무소속일 때만';
  if (S.free.tryOffer) return '받은 제의부터 정해 주세요';
  if (injured(t)) return '부상 중이에요';
  if (S.stamina < TRYOUT_STAMINA) return '스태미나가 부족해요';
  return null;
}
function tryout(tier) {
  if (canTryout(tier)) return null;
  S.stamina -= TRYOUT_STAMINA;
  const ok = chance(tryoutChance(tier));
  if (ok) {
    const of = makeOffer(pick(teamsOfTier(tier)), myOvr());
    of.salary = Math.max(100, Math.round(of.salary * 0.6 / 100) * 100);
    of.years = 1;
    S.free.tryOffer = of;
  }
  hooks.changed();
  return ok;
}
function signFree(which) {
  if (!S.free) return;
  const of = which === 'try' ? S.free.tryOffer : S.free.market[which];
  if (of) signContract(of, 'free');
  hooks.changed();
}
function declineTryOffer() { if (S.free) { S.free.tryOffer = null; hooks.changed(); } }
function tickFree(t) {
  if (!S.free || t < S.free.window) return;
  const last = S.career.history[S.career.history.length - 1];
  const m = openMarket(last ? last.avg : 0, false, { free: true });
  S.free.market = m.offers;
  S.free.window = t + FA_WINDOW_SEC * 1000;
  hooks.banner('📨 이적시장', m.offers.length ? `${m.offers.length}개 팀이 관심을 보여요` : '이번에도 연락이 없어요… 계속 훈련해요');
}

// ───────────────────────── 은퇴 ─────────────────────────
function retire() {
  const c = S.career;
  const legend = {
    name: S.name, gen: S.gen, pos: S.pos, title: S.title, age: S.age,
    apps: c.apps, goals: c.goals, assists: c.assists, trophies: c.trophies.length, awards: c.awards.length,
    fame: S.fame, peakTeam: S.career.history.slice().sort((a, b) => b.tier - a.tier)[0]?.team || '',
  };
  S.legends = (S.legends || []).concat([legend]);
  S.retiredAt = Date.now();
  S.phase = 'retired';
  S.pendingEnd = null;
  hooks.changed();
}
// 은퇴 뒤 같은 계정으로 다음 세대 선수를 시작. 업적만큼 시작 능력치 보너스
function legacyBonus() {
  const c = S.career;
  return clamp(Math.floor(c.goals / 60 + c.awards.length / 3 + c.trophies.length / 2), 0, 12) + (S.legacy || 0) / 2 | 0;
}
function startNextGen(pos, foot, special) {
  const keep = { legends: S.legends, gen: S.gen + 1, name: S.name };
  const legacy = Math.min(16, legacyBonus());
  S = newSave(keep.name, pos, foot, special, legacy);
  S.gen = keep.gen;
  S.legends = keep.legends;
  newSeason(pick(teamsOfTier(0)).id);
  hooks.changed();
}

// ───────────────────────── 시간 흐름 ─────────────────────────
// 자동 출전: 휴식으로 스태미나가 다 차면 알아서 다시 나간다 (꺼 둔 동안에도 같은 규칙).
// 시즌 결산·무소속·은퇴 중에는 멈추고, 부상이면 회복한 뒤에 나간다. 끄려면 S.auto = false
const autoOn = () => S.auto !== false;
function autoStartAt() {
  if (!autoOn() || S.mode !== 'home' || S.free || !S.season || S.season.done || S.pendingEnd || S.phase === 'retired') return null;
  const from = Math.max(S.lastTick, S.homeAt || 0);
  const fullAt = from + Math.max(0, stamMax() - S.stamina) / restRate() * 1000;
  return Math.max(fullAt, S.injury ? S.injury.until : 0);
}
function tick(t = Date.now()) {
  if (!S || S.phase === 'retired') return;
  tickBuild(t);
  tickLove(t);
  tickFree(t);
  if (S.injury && t >= S.injury.until) { hooks.toast(`💪 ${S.injury.name} 회복! 다시 뛸 수 있어요`); S.injury = null; }
  let guard = 0;
  while (guard++ < 2000) {
    if (S.mode === 'run') {
      const r = S.run;
      if (r.phase === 'travel') {
        if (t < r.t0 + TRAVEL_SEC * 1000) break;
        startMatch(r.t0 + TRAVEL_SEC * 1000);
      } else if (r.phase === 'match') {
        const end = r.match.t0 + MATCH_SEC * 1000;
        if (t < end) break;
        applyMatch(end);
        r.match = null;
        const cont = !r.stop && !injured(end) && S.stamina >= staminaCost() && !S.season.done;
        r.phase = cont ? 'travel' : 'back';
        r.t0 = end;
      } else {
        if (t < r.t0 + TRAVEL_SEC * 1000) break;
        S.homeAt = r.t0 + TRAVEL_SEC * 1000;
        S.mode = 'home';
        S.run = null;
        hooks.toast('🏠 집에 돌아왔어요');
      }
      continue;
    }
    const at = autoStartAt();
    if (at == null || at > t) break;
    S.stamina = stamMax();
    S.lastTick = at;
    if (S.injury && at >= S.injury.until) S.injury = null;
    S.mode = 'run';
    S.run = { phase: 'travel', t0: at, stop: false, played: 0, match: null, auto: true };
  }
  if (S.mode === 'home') {
    const from = Math.max(S.lastTick, S.homeAt || 0);
    if (t > from) S.stamina = Math.min(stamMax(), S.stamina + (t - from) / 1000 * restRate());
  }
  S.lastTick = t;
}
