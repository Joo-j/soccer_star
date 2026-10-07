'use strict';
// 게임 상태 S 와 성장 규칙: 능력치·레벨·훈련·시설·장비·스태미나·부상·인기·저장.
// 시즌·경기 진행은 career.js, 경기 계산은 match.js, 화면은 ui.js / bar.js.

let S = null;
const hooks = { toast: () => {}, changed: () => {}, banner: () => {} };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
function weighted(list, wf) {
  const total = list.reduce((s, x) => s + wf(x), 0);
  let r = Math.random() * total;
  for (const x of list) { r -= wf(x); if (r <= 0) return x; }
  return list[list.length - 1];
}

// 만원 단위 정수 → "3억 2,000만원"
function fmtMoney(man) {
  man = Math.floor(man);
  const sign = man < 0 ? '-' : '';
  man = Math.abs(man);
  if (man >= 10000) {
    const eok = Math.floor(man / 10000), rest = man % 10000;
    return `${sign}${eok.toLocaleString()}억${rest ? ' ' + rest.toLocaleString() + '만' : ''}원`;
  }
  return `${sign}${man.toLocaleString()}만원`;
}
function fmtNum(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1) + '억';
  if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e5 ? 0 : 1) + '만';
  return Math.floor(n).toLocaleString();
}
function fmtSec(sec) {
  sec = Math.max(0, Math.ceil(sec));
  if (sec >= 3600) return `${Math.floor(sec / 3600)}시간 ${Math.floor(sec % 3600 / 60)}분`;
  if (sec >= 60) return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
  return `${sec}초`;
}

// ───────────────────────── 새 선수 ─────────────────────────
function newSave(name, pos, foot, special, legacy = 0) {
  const st = { ...POSITIONS[pos].start };
  st[special] += 4;
  for (const k in st) st[k] += legacy;
  const s = {
    v: SAVE_V, name, createdAt: Date.now(), gen: 1,
    pos, foot, special, style: null, title: null,
    lv: 1, exp: 0, sp: 1, money: 30, fame: 0, notes: 2,
    stats: st, skills: {},
    age: 16, phase: 'school', grade: 1,
    teamId: null, contract: null,
    season: null, pendingEnd: null,
    career: { apps: 0, goals: 0, assists: 0, mom: 0, cs: 0, trophies: [], awards: [], history: [] },
    gear: { inv: [], eq: { boots: null, guard: null, acc: null }, enh: { boots: 0, guard: 0, acc: 0 } },
    bld: { gym: 0, home: 0, clinic: 0, agency: 0 }, building: null,
    stamina: 100, mode: 'home', run: null, homeAt: Date.now(),
    injury: null, sponsors: [],
    love: { partner: null, aff: 0, cd: {}, lastDate: 0 },
    reports: [], bd: null, legacy,
    guide: {}, lastSeen: Date.now(), lastTick: Date.now(), nextGearId: 1,
  };
  return s;
}

// ───────────────────────── 능력치 ─────────────────────────
function styleOf(s = S) { return s.style ? STYLES[s.pos].find((x) => x.id === s.style) : null; }
function gearBonus(s = S) {
  const b = { sho: 0, pas: 0, dri: 0, def: 0, phy: 0 };
  for (const slot in SLOTS) {
    const g = s.gear.inv.find((x) => x.id === s.gear.eq[slot]);
    if (!g) continue;
    const gb = gearStat(g, s.gear.enh[slot]);
    b[SLOTS[slot].main] += gb.main;
    b[SLOTS[slot].sub] += gb.sub;
  }
  return b;
}
function gearStat(g, enh) {
  const base = GRADES[g.grade].bonus * (1 + enh * 0.08);
  return { main: Math.round(base), sub: Math.round(base * 0.5) };
}
function ageFactor(s = S) {
  const peak = s.pos === 'GK' ? 34 : 31;
  return 1 - Math.max(0, s.age - peak) * 0.03;
}
// 경기에 쓰이는 실제 능력치 (스타일·칭호 배율, 장비, 나이)
function effStats(s = S) {
  const st = styleOf(s);
  const gb = gearBonus(s);
  const af = ageFactor(s);
  const out = {};
  for (const { id } of STATS) {
    let m = 1;
    if (st) m += st.mul[id] || 0;
    if (st && s.title) m += st.tmul[id] || 0;
    out[id] = Math.round((s.stats[id] * m + gb[id]) * af);
  }
  return out;
}
function ovrOf(stats, pos) {
  const w = POSITIONS[pos].w;
  let v = 0;
  for (const k in w) v += stats[k] * w[k];
  return Math.round(v);
}
const myOvr = (s = S) => ovrOf(effStats(s), s.pos);

// 몸값 (만원)
function marketValue(s = S) {
  const o = myOvr(s);
  const ageMul = s.age <= 23 ? 1.3 : s.age <= 29 ? 1 : Math.max(0.2, 1 - (s.age - 29) * 0.12);
  const fameMul = 1 + Math.log10(1 + s.fame) / 8;
  return Math.round(3 * Math.pow(1.13, o - 30) * ageMul * fameMul);
}
function fameTier(f = S.fame) { let t = FAME_TIERS[0]; for (const x of FAME_TIERS) if (f >= x.min) t = x; return t; }

// ───────────────────────── 레벨 ─────────────────────────
const expReq = (lv) => Math.round(80 * Math.pow(1.16, lv - 1));
function addExp(n) {
  S.exp += Math.round(n);
  let up = 0;
  while (S.exp >= expReq(S.lv)) { S.exp -= expReq(S.lv); S.lv++; S.sp++; up++; }
  if (up) {
    hooks.toast(`⬆️ 레벨 업! Lv ${S.lv} (스킬 포인트 +${up})`);
    if (S.lv >= STYLE_LV && !S.style && S.lv - up < STYLE_LV) hooks.banner('🎨 플레이 스타일을 고를 수 있어요!', '스킬 탭에서 스타일을 정해 주세요');
    if (S.lv >= TITLE_LV && S.style && !S.title && S.lv - up < TITLE_LV) hooks.banner('🏅 칭호를 받을 수 있어요!', '스킬 탭에서 칭호를 받아 주세요');
  }
}

// ───────────────────────── 훈련 ─────────────────────────
function trainCost(id, s = S) {
  let c = 2 * Math.pow(1.095, s.stats[id]);
  if (s.special === id) c *= 0.6;
  const st = styleOf(s);
  if (st && st.train.includes(id)) c *= 0.8;
  return Math.max(1, Math.round(c));
}
function canTrain(id) {
  if (S.stats[id] >= trainCap(S.bld.gym)) return '훈련장 레벨을 올려야 해요';
  if (S.money < trainCost(id)) return '돈이 부족해요';
  return null;
}
function train(id) {
  if (canTrain(id)) return false;
  S.money -= trainCost(id);
  S.stats[id]++;
  hooks.changed();
  return true;
}

// ───────────────────────── 시설 ─────────────────────────
function canBuild(id) {
  const b = BUILDINGS.find((x) => x.id === id);
  if (S.building) return '다른 공사가 진행 중이에요';
  if (S.bld[id] >= b.max) return '최대 레벨이에요';
  if (S.money < buildCost(S.bld[id])) return '돈이 부족해요';
  return null;
}
function startBuild(id) {
  if (canBuild(id)) return false;
  S.money -= buildCost(S.bld[id]);
  S.building = { id, until: Date.now() + buildSec(S.bld[id]) * 1000 };
  hooks.changed();
  return true;
}
function tickBuild(t) {
  if (S.building && t >= S.building.until) {
    const b = BUILDINGS.find((x) => x.id === S.building.id);
    S.bld[b.id]++;
    S.building = null;
    hooks.toast(`${b.icon} ${b.name} Lv ${S.bld[b.id]} 완공!`);
  }
}

// ───────────────────────── 장비 ─────────────────────────
function makeGear(grade, slot = pick(Object.keys(SLOTS))) {
  return { id: S.nextGearId++, slot, grade, name: GEAR_NAMES[slot][grade] };
}
// 리그가 높을수록 좋은 상자. 반환: 등급
function rollGrade(tier, bonus = 0) {
  const w = [[70, 25, 5, 0, 0, 0], [50, 35, 12, 3, 0, 0], [30, 40, 22, 7, 1, 0], [15, 35, 32, 14, 4, 0], [5, 25, 35, 24, 9, 2]][tier];
  const list = w.map((x, i) => ({ i: Math.min(5, i + bonus), x }));
  return weighted(list, (o) => o.x).i;
}
const INV_MAX = 40;
function addGear(g) {
  if (S.gear.inv.length >= INV_MAX) { const price = sellPrice(g); S.money += price; return `가방이 가득 차서 ${g.name}을(를) ${fmtMoney(price)}에 팔았어요`; }
  S.gear.inv.push(g);
  if (g.grade >= 3) hooks.banner(`${GRADES[g.grade].name} 장비 획득!`, `${SLOTS[g.slot].icon} ${g.name}`);
  return null;
}
const sellPrice = (g) => Math.round(8 * Math.pow(3, g.grade));
function equip(id) {
  const g = S.gear.inv.find((x) => x.id === id);
  if (!g) return;
  S.gear.eq[g.slot] = g.id;
  hooks.changed();
}
function autoEquip() {
  for (const slot in SLOTS) {
    const best = S.gear.inv.filter((g) => g.slot === slot).sort((a, b) => b.grade - a.grade)[0];
    if (best) S.gear.eq[slot] = best.id;
  }
  hooks.changed();
}
function sellGear(id) {
  const i = S.gear.inv.findIndex((x) => x.id === id);
  if (i < 0 || Object.values(S.gear.eq).includes(id)) return;
  S.money += sellPrice(S.gear.inv[i]);
  S.gear.inv.splice(i, 1);
  hooks.changed();
}
function sellBelow(grade) {
  const eq = Object.values(S.gear.eq);
  let n = 0, sum = 0;
  S.gear.inv = S.gear.inv.filter((g) => {
    if (g.grade <= grade && !eq.includes(g.id)) { n++; sum += sellPrice(g); return false; }
    return true;
  });
  S.money += sum;
  hooks.changed();
  return { n, sum };
}
function enhance(slot) {
  const lv = S.gear.enh[slot];
  if (lv >= ENH_MAX) return null;
  const info = enhanceInfo(lv);
  if (S.money < info.cost) return null;
  S.money -= info.cost;
  let res;
  if (chance(info.rate)) { S.gear.enh[slot]++; res = 'ok'; }
  else if (info.drop) { S.gear.enh[slot]--; res = 'drop'; }
  else res = 'fail';
  hooks.changed();
  return res;
}

// ───────────────────────── 스킬 · 스타일 ─────────────────────────
function skillsFor(pos) { return SKILLS.filter((k) => k.pos.includes(pos)); }
function canLearn(id) {
  const k = SKILL_BY_ID[id];
  if (S.skills[id]) return '이미 배웠어요';
  if (!k.pos.includes(S.pos)) return '포지션이 맞지 않아요';
  if (S.lv < k.lv) return `Lv ${k.lv}부터 배울 수 있어요`;
  if (S.sp < 1) return '스킬 포인트가 없어요';
  return null;
}
function learnSkill(id) {
  if (canLearn(id)) return false;
  S.sp--;
  S.skills[id] = 1;
  hooks.toast(`✨ ${SKILL_BY_ID[id].name} 습득!`);
  hooks.changed();
  return true;
}
function canMaster(id) {
  const lv = S.skills[id];
  if (!lv) return '먼저 배워야 해요';
  if (lv >= SKILL_MAX) return '최고 숙련도예요';
  if (S.notes < skillNoteCost(lv)) return '연습 노트가 부족해요';
  return null;
}
function masterSkill(id) {
  if (canMaster(id)) return false;
  S.notes -= skillNoteCost(S.skills[id]);
  S.skills[id]++;
  hooks.changed();
  return true;
}
const skillPow = (id, lv) => SKILL_BY_ID[id].pow * (1 + 0.15 * (lv - 1));
function chooseStyle(id) {
  if (S.style || S.lv < STYLE_LV) return;
  S.style = id;
  hooks.toast(`🎨 플레이 스타일: ${styleOf().name}`);
  hooks.changed();
}
function takeTitle() {
  if (!S.style || S.title || S.lv < TITLE_LV) return;
  S.title = styleOf().title;
  hooks.banner('🏅 칭호 획득', `「${S.title}」`);
  hooks.changed();
}

// ───────────────────────── 스태미나 · 휴식 · 부상 ─────────────────────────
const stamMax = (s = S) => staminaMax(s.bld.home);
function restRate() { // 초당 회복량
  let sec = restSec(S.bld.home);
  const st = loveStage();
  if (st >= 2) sec *= st >= 4 ? 0.75 : 0.85;
  return stamMax() / sec;
}
function staminaCost() {
  let c = STAMINA_PER_MATCH * (1 - S.stats.phy / 400);
  if (S.style === 'b2b') c *= 0.8;
  return Math.round(c);
}
const injured = (t = Date.now()) => S.injury && t < S.injury.until;
function rollInjury(lowStamina) {
  let p = 0.022 * (1 - S.bld.clinic * 0.08);
  if (lowStamina) p *= 2;
  if (S.age >= 32) p *= 1.4;
  if (!chance(p)) return null;
  const inj = weighted(INJURIES, (x) => x.w);
  return { name: inj.name, sec: Math.round(inj.sec * (1 - S.bld.clinic * 0.08)) };
}

// ───────────────────────── 인기 · 스폰서 ─────────────────────────
function addFame(n) {
  const before = fameTier().name;
  S.fame += Math.round(n);
  if (fameTier().name !== before) hooks.banner(`${fameTier().icon} ${fameTier().name}`, `팔로워 ${fmtNum(S.fame)}명 돌파`);
  for (const sp of SPONSORS) {
    if (S.fame >= sp.fame && !S.sponsors.includes(sp.id)) {
      S.sponsors.push(sp.id);
      const g = makeGear(sp.box);
      addGear(g);
      hooks.banner('🤝 스폰서 계약', `${sp.name} — 경기당 ${fmtMoney(sp.pay)} · ${g.name} 지급`);
    }
  }
}
const sponsorPay = () => SPONSORS.filter((x) => S.sponsors.includes(x.id)).reduce((a, x) => a + x.pay, 0) * (1 + S.bld.agency * 0.1);

// ───────────────────────── 연애 ─────────────────────────
function loveStage(s = S) {
  if (!s.love.partner) return -1;
  let i = 0;
  LOVE_STAGES.forEach((x, k) => { if (s.love.aff >= x.min) i = k; });
  return i;
}
function canDate(id, t = Date.now()) {
  const d = DATES.find((x) => x.id === id);
  if (!S.love.partner) return '만나는 사람이 없어요';
  if (S.mode !== 'home') return '집에 있을 때만 할 수 있어요';
  const left = (S.love.cd[id] || 0) - t;
  if (left > 0) return `${fmtSec(left / 1000)} 뒤에`;
  if (S.money < d.cost) return '돈이 부족해요';
  return null;
}
function doDate(id) {
  if (canDate(id)) return null;
  const d = DATES.find((x) => x.id === id);
  const before = loveStage();
  S.money -= d.cost;
  S.love.aff = clamp(S.love.aff + d.aff, 0, 100);
  S.love.cd[id] = Date.now() + d.cd * 1000;
  S.love.lastDate = Date.now();
  const after = loveStage();
  const p = PARTNERS.find((x) => x.id === S.love.partner);
  if (after > before) {
    hooks.banner(`💕 ${p.name}와(과) ${LOVE_STAGES[after].name}`, after === 2 ? '휴식 속도 +15%' : after === 4 ? '휴식 속도 +25% · 인기 +10%' : '');
    if (after === 2) addFame(S.fame * 0.03 + 500);
    if (after === 4) addFame(S.fame * 0.1 + 5000);
  }
  hooks.changed();
  return d;
}
function meet(id) {
  const p = PARTNERS.find((x) => x.id === id);
  if (S.fame < p.fame) return;
  S.love = { partner: id, aff: 5, cd: {}, lastDate: Date.now() };
  hooks.toast(`${p.emoji} ${p.name}을(를) 만났어요`);
  hooks.changed();
}
function breakUp() {
  S.love = { partner: null, aff: 0, cd: {}, lastDate: 0 };
  hooks.changed();
}
// 6시간 넘게 연락이 없으면 시간당 호감 -2 (결혼하면 줄지 않음)
function tickLove(t) {
  if (!S.love.partner || loveStage() >= 4) return;
  const idle = (t - S.love.lastDate) / 3600000 - 6;
  if (idle <= 0) return;
  const loss = Math.floor(idle) * 2;
  if (loss <= 0) return;
  S.love.aff -= loss;
  S.love.lastDate += Math.floor(idle) * 3600000;
  if (S.love.aff <= 0) {
    const p = PARTNERS.find((x) => x.id === S.love.partner);
    hooks.banner('💔 이별', `${p.name}이(가) 연락 없는 당신을 떠났어요`);
    breakUp();
  }
}

// ───────────────────────── 저장 ─────────────────────────
const SAVE_KEY = (name) => `soccer-star-save-v1:${name.toLowerCase()}`;
function saveLocal() {
  if (!S) return;
  S.lastSeen = Date.now();
  try { localStorage.setItem(SAVE_KEY(S.name), JSON.stringify(S)); } catch {}
}
function loadLocal(name) {
  try { const raw = localStorage.getItem(SAVE_KEY(name)); return raw ? migrate(JSON.parse(raw)) : null; } catch { return null; }
}
function migrate(s) {
  if (!s || typeof s !== 'object') return null;
  // 0.2.0부터 시즌 결산의 제의 목록이 이적시장(market)으로 바뀌었다
  const pe = s.pendingEnd;
  if (pe && !pe.market && !pe.draft && !pe.schoolNext) {
    pe.market = { offers: pe.offers || [], under: !!pe.underContract, released: false };
  }
  s.v = SAVE_V;
  return s;
}
