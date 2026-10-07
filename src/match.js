'use strict';
// 경기 계산. 경기 시작 때 90분을 한 번에 계산해 사건 목록(events)을 만들고, bar.js 가 그 목록을 실시간으로 재생한다.
// 화면도 상태 S 도 건드리지 않는다 — 결과 반영은 career.js 의 applyMatch.

function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// 다른 경기 결과 (선수 개인 기록 없이 점수만)
function quickSim(home, away) {
  const d = (home.r + 1.5 - away.r) * 0.05;
  return [poisson(clamp(1.35 + d, 0.3, 3.6)), poisson(clamp(1.15 - d, 0.25, 3.4))];
}

// 팀 골을 AI 스타에게 나눠 준다 → { scorer: key|null, assist: key|null }
function allocGoal(teamId) {
  const r = Math.random(), r2 = Math.random();
  return {
    scorer: r < 0.42 ? teamId + ':fw' : r < 0.62 ? teamId + ':mf' : null,
    assist: r2 < 0.34 ? teamId + ':mf' : r2 < 0.46 ? teamId + ':fw' : null,
  };
}

// me: { name, pos, st(유효 능력치), skills, style, staminaRatio, injury(rollInjury 결과|null), tier }
// reals: 상대 팀의 실제 플레이어 [{ name, pos }]
function simMatch({ me, myTeam, oppTeam, home, reals = [], stars }) {
  const ev = [];
  const push = (min, type, o = {}) => ev.push({ min, type, ...o });
  const sf = 0.82 + 0.18 * clamp(me.staminaRatio, 0, 1);
  const st = {};
  for (const k in me.st) st[k] = me.st[k] * sf;
  const ovr = ovrOf(st, me.pos);
  const A = myTeam.r + (ovr - myTeam.r) * 0.18 + (home ? 1.5 : 0);
  const B = oppTeam.r + (home ? 0 : 1.5);
  const pMy = clamp(0.5 + (A - B) * 0.015, 0.18, 0.82);
  const baseConv = (att, def) => clamp(0.13 + (att - def) * 0.006, 0.04, 0.3);

  const owned = (kind) => Object.entries(me.skills).filter(([id]) => SKILL_BY_ID[id].kind === kind && SKILL_BY_ID[id].pos.includes(me.pos));
  const useSkill = (kind, p) => {
    const list = owned(kind);
    if (!list.length || !chance(p)) return null;
    const [id, lv] = weighted(list, ([, l]) => 1 + l);
    return { id, name: SKILL_BY_ID[id].name, fx: SKILL_BY_ID[id].fx, bonus: skillPow(id, lv) };
  };

  const inv = {
    FW: [0.36, 0.18], MF: [0.16, 0.3], DF: [0.05, 0.07], GK: [0, 0.02],
  }[me.pos].slice();
  if (me.style === 'wingback') { inv[0] *= 2; inv[1] *= 2; }
  if (me.style === 'maestro') inv[1] *= 1.25;
  if (me.style === 'sweeper') inv[1] = 0.05;
  if (me.style === 'builder') inv[1] *= 1.3;
  const defInv = { FW: 0.04, MF: 0.18, DF: 0.45, GK: 0 }[me.pos];

  const m = { g: 0, a: 0, sh: 0, tk: 0, sv: 0, dr: 0, conc: 0, leftAt: null, injury: null };
  const score = [0, 0];
  const scorers = [];
  const injMin = me.injury ? 10 + Math.floor(Math.random() * 75) : 99;
  let active = true;
  const starName = (key) => (stars[key] ? stars[key].name : null);

  push(0, 'kick', { text: '킥오프!' });
  for (let min = 1; min <= 90; min++) {
    if (min === 46) push(45, 'half', { text: `전반 종료 ${score[0]} : ${score[1]}` });
    if (active && min >= injMin) {
      active = false;
      m.leftAt = min; m.injury = me.injury;
      push(min, 'injury', { who: 'me', text: `🚑 ${me.name} 부상으로 교체 (${me.injury.name})` });
    }
    if (!chance(0.25)) continue;
    if (chance(pMy)) {
      // ── 우리 팀 공격
      const r = Math.random();
      let conv = baseConv(A, B);
      if (active && r < inv[0]) {
        let dribBonus = 0;
        const drib = useSkill('drib', me.style === 'speedster' ? 0.45 : 0.35);
        if (drib) {
          const ok = chance(clamp(0.5 + (st.dri - B) * 0.01 + drib.bonus, 0.15, 0.92));
          push(min, 'drib', { who: 'me', skill: drib, ok, text: ok ? `💨 ${me.name}의 ${drib.name}! 수비를 제쳤다` : `${me.name}의 ${drib.name}, 수비에 막혔다` });
          if (!ok) continue;
          m.dr++;
          dribBonus = me.style === 'technician' ? 0.1 : 0.05;
        }
        const sk = useSkill('shot', 0.55);
        let c = 0.16 + (st.sho - B) * 0.007 + dribBonus + (sk ? sk.bonus * (sk.id === 'header' && me.style === 'target' ? 2 : 1) : 0);
        if (me.style === 'poacher') c *= 1.08;
        c = clamp(c, 0.05, 0.62);
        m.sh++;
        if (chance(c)) {
          score[0]++; m.g++;
          scorers.push({ side: 0, key: 'me', min });
          push(min, 'goal', { side: 0, who: 'me', scorer: me.name, skill: sk, text: `⚽ 골!! ${me.name}${sk ? `의 ${sk.name}` : ''}! (${score[0]}:${score[1]})` });
        } else {
          const saved = chance(0.5);
          push(min, saved ? 'save' : 'miss', { side: 0, who: 'me', skill: sk, text: `${me.name}${sk ? `의 ${sk.name}` : '의 슛'}, ${saved ? '골키퍼 선방' : '골대를 살짝 벗어났다'}` });
        }
      } else if (active && r < inv[0] + inv[1]) {
        const sk = useSkill('pass', 0.5);
        const c = clamp(conv + (st.pas - B) * 0.005 + (sk ? sk.bonus : 0), 0.05, 0.5);
        const mate = allocGoal(myTeam.id);
        const sName = starName(mate.scorer) || '동료';
        if (chance(c)) {
          score[0]++; m.a++;
          scorers.push({ side: 0, key: mate.scorer, assist: 'me', min });
          push(min, 'goal', { side: 0, who: 'mate', scorer: sName, assist: 'me', skill: sk, text: `⚽ 골! ${me.name}${sk ? `의 ${sk.name}` : '의 패스'}를 ${sName}이(가) 마무리 (${score[0]}:${score[1]})` });
        } else {
          push(min, 'chance', { side: 0, who: 'me', skill: sk, text: `${me.name}${sk ? `의 ${sk.name}` : '의 패스'}, ${sName}의 슛은 빗나갔다` });
        }
      } else {
        if (chance(conv)) {
          score[0]++;
          const g = allocGoal(myTeam.id);
          scorers.push({ side: 0, key: g.scorer, assist: g.assist, min });
          push(min, 'goal', { side: 0, who: 'mate', scorer: starName(g.scorer) || '동료', text: `⚽ 골! ${starName(g.scorer) || '동료'} 득점 (${score[0]}:${score[1]})` });
        } else push(min, 'chance', { side: 0, who: 'mate', text: '' });
      }
    } else {
      // ── 상대 공격
      if (active && defInv && chance(defInv)) {
        const sk = useSkill('def', 0.5);
        const ok = chance(clamp(0.35 + (st.def - B) * 0.012 + (sk ? sk.bonus : 0) + (me.style === 'stopper' ? 0.1 : 0), 0.1, 0.9));
        if (ok) {
          m.tk++;
          push(min, 'tackle', { side: 1, who: 'me', skill: sk, text: `🛡️ ${me.name}${sk ? `의 ${sk.name}` : '의 태클'}! 위기를 막았다` });
          continue;
        }
      }
      let c = baseConv(B, A);
      const real = reals.length && chance(0.5) ? pick(reals.filter((x) => x.pos !== 'GK').length ? reals.filter((x) => x.pos !== 'GK') : reals) : null;
      const og = allocGoal(oppTeam.id);
      const oName = real ? `${real.name}(플레이어)` : starName(og.scorer) || '상대';
      if (me.pos === 'GK' && active) {
        const sk = useSkill('gk', 0.55);
        const adj = (st.def - B) * 0.008 + (sk ? sk.bonus : 0) + (me.style === 'reflex' ? 0.05 : 0) + (me.style === 'wall' ? 0.04 : 0);
        c = clamp(c + 0.1 - adj, 0.03, 0.55);
        if (chance(c)) {
          score[1]++; m.conc++;
          scorers.push({ side: 1, key: real ? null : og.scorer, assist: real ? null : og.assist, real: real && real.name, min });
          push(min, 'goal', { side: 1, who: 'opp', scorer: oName, text: `실점… ${oName} 득점 (${score[0]}:${score[1]})` });
        } else {
          m.sv++;
          push(min, 'save', { side: 1, who: 'me', skill: sk, text: `🧤 ${me.name}${sk ? `의 ${sk.name}` : ''} 선방!` });
        }
      } else if (chance(c)) {
        score[1]++;
        if (active) m.conc++;
        scorers.push({ side: 1, key: real ? null : og.scorer, assist: real ? null : og.assist, real: real && real.name, min });
        push(min, 'goal', { side: 1, who: 'opp', scorer: oName, text: `실점… ${oName} 득점 (${score[0]}:${score[1]})` });
      } else push(min, 'chance', { side: 1, who: 'opp', text: '' });
    }
  }
  push(90, 'end', { text: `경기 종료 ${score[0]} : ${score[1]}` });

  const res = score[0] > score[1] ? 'W' : score[0] === score[1] ? 'D' : 'L';
  const played = m.leftAt ? m.leftAt / 90 : 1;
  let rating = 6.0 + m.g * 1.0 + m.a * 0.7 + m.tk * 0.35 + m.sv * 0.18 + m.dr * 0.1 + (m.sh - m.g) * 0.04;
  if (me.pos === 'GK') rating -= m.conc * 0.35;
  if (me.pos === 'DF') rating -= m.conc * 0.2;
  if ((me.pos === 'GK' || me.pos === 'DF') && score[1] === 0 && !m.leftAt) rating += 0.6;
  rating += { W: 0.4, D: 0.1, L: -0.2 }[res];
  rating = 6 + (rating - 6) * (0.4 + 0.6 * played) + (Math.random() - 0.5) * 0.4;
  rating = Math.round(clamp(rating, 3, 10) * 10) / 10;
  m.rating = rating;
  m.mom = rating >= 7.8;
  m.cs = (me.pos === 'GK' || me.pos === 'DF') && score[1] === 0 && !m.leftAt;
  return { events: ev, score, res, me: m, scorers };
}

// 1:1 승부차기 재생용 계산 (서버도 같은 식을 쓴다 — server/duel.js)
function pkKick(kick, keep) { return clamp(0.75 + (kick - keep) * 0.006, 0.45, 0.93); }

// ───────────────────────── 재생 시간표 ─────────────────────────
// 90분을 MATCH_SEC 초에 그대로 늘어놓지 않는다. 볼 만한 장면(내 활약·골·슛·선방)에 실제 시간을 몰아주고
// 아무 일 없는 구간은 빨리 넘긴다. bar.js(그림)와 ui.js(HUD 시계·점수)가 같은 시간표를 쓴다.
const SCENE_MS = { base: 3800, goal: 2600, me: 1200, kick: 1400, half: 1600, end: 2400 };
const planCache = new WeakMap();
function isScene(e) {
  if (['goal', 'miss', 'save', 'tackle', 'drib'].includes(e.type)) return true;
  return e.type === 'chance' && e.who === 'me';
}
function matchPlan(res) {
  if (planCache.has(res)) return planCache.get(res);
  const total = MATCH_SEC * 1000;
  const ev = res.events;
  // 동료·상대의 평범한 찬스는 몇 개만 골라 장면으로 (분위기용)
  const extra = ev.filter((e) => e.type === 'chance' && e.who !== 'me').filter((e, i) => (e.min * 7 + i) % 3 === 0).slice(0, 5);
  const scenes = ev.filter(isScene).concat(extra).sort((a, b) => a.min - b.min);
  const durOf = (e) => SCENE_MS.base + (e.type === 'goal' ? SCENE_MS.goal : 0) + (e.who === 'me' ? SCENE_MS.me : 0);
  let fixed = SCENE_MS.kick + SCENE_MS.half + SCENE_MS.end + scenes.reduce((s, e) => s + durOf(e), 0);
  const scale = fixed > total * 0.86 ? (total * 0.86) / fixed : 1;
  const segs = [];
  let cur = 0;
  segs.push({ kind: 'kick', m0: 0, m1: 0, dur: SCENE_MS.kick * scale });
  let halfDone = false;
  const pushQuiet = (m1) => { if (m1 > cur) { segs.push({ kind: 'quiet', m0: cur, m1 }); cur = m1; } };
  for (const e of scenes) {
    if (!halfDone && e.min > 45) { pushQuiet(45); segs.push({ kind: 'half', m0: 45, m1: 45, dur: SCENE_MS.half * scale }); halfDone = true; }
    pushQuiet(Math.max(cur, e.min - 1));
    segs.push({ kind: 'scene', ev: e, m0: cur, m1: Math.max(cur, e.min), dur: durOf(e) * scale });
    cur = Math.max(cur, e.min);
  }
  if (!halfDone) { pushQuiet(45); segs.push({ kind: 'half', m0: 45, m1: 45, dur: SCENE_MS.half * scale }); }
  pushQuiet(90);
  segs.push({ kind: 'end', m0: 90, m1: 90, dur: SCENE_MS.end * scale });
  const fixedSum = segs.filter((s) => s.kind !== 'quiet').reduce((a, s) => a + s.dur, 0);
  const quietMin = segs.filter((s) => s.kind === 'quiet').reduce((a, s) => a + (s.m1 - s.m0), 0) || 1;
  let t = 0;
  for (const s of segs) {
    if (s.kind === 'quiet') s.dur = (total - fixedSum) * (s.m1 - s.m0) / quietMin;
    s.t0 = t;
    t += s.dur;
  }
  const plan = { segs, scenes };
  planCache.set(res, plan);
  return plan;
}
// 경기 시작 후 elapsed ms → { seg, k(구간 안 진행 0~1), ms(구간 안 경과 ms), min(경기 분) }
function matchClock(res, elapsed) {
  const { segs } = matchPlan(res);
  let seg = segs[segs.length - 1];
  for (const s of segs) if (elapsed < s.t0 + s.dur) { seg = s; break; }
  const ms = clamp(elapsed - seg.t0, 0, seg.dur);
  const k = seg.dur ? ms / seg.dur : 1;
  return { seg, k, ms, min: seg.m0 + (seg.m1 - seg.m0) * k };
}
// 슛이 골문에 닿는 순간 (장면 시작 후 ms)
const sceneShotMs = (seg) => Math.min(seg.dur * 0.62, 1900 + (seg.ev.who === 'me' ? 1300 : 700));
// 지금까지 들어간 골 [우리, 상대]
function scoreAt(res, elapsed) {
  const sc = [0, 0];
  for (const s of matchPlan(res).segs) {
    if (s.kind !== 'scene' || s.ev.type !== 'goal') continue;
    if (elapsed >= s.t0 + sceneShotMs(s)) sc[s.ev.side]++;
  }
  return sc;
}
