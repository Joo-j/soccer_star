'use strict';
// 하단 띠 캔버스: 집(휴식) · 이동(버스) · 경기 재생 · 승부차기 재생.
// 상태를 들고 있지 않고 매 프레임 시간과 S 로부터 그림을 계산한다 (경기 장면은 match.js 의 사건 목록을 시간에 맞춰 재생).

const Bar = (() => {
  const P = 2; // 도트 한 칸 크기
  let cv, ctx, W = 800, H = 150, dpr = 1;
  let duelShow = null; // { duel, t0, meIsA }

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    resize();
    addEventListener('resize', resize);
    requestAnimationFrame(frame);
  }
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = cv.clientWidth || innerWidth;
    H = cv.clientHeight || 150;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

  // ───────────────────────── 도트 사람 ─────────────────────────
  // c: { shirt, shorts, skin, hair }, f: 걷기 프레임, opt: { flip, jump, slide, dive, sit, star }
  function person(x, y, c, f = 0, opt = {}) {
    const px = (cx, cy, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x + cx * P), Math.round(y + cy * P), w * P, h * P); };
    ctx.save();
    if (opt.slide) { ctx.translate(x, y); ctx.rotate(opt.flip ? 1.2 : -1.2); ctx.translate(-x, -y); }
    if (opt.dive) { ctx.translate(x, y - 6); ctx.rotate(opt.dive); ctx.translate(-x, -(y - 6)); }
    const jy = opt.jump ? -Math.abs(Math.sin(opt.jump)) * 8 : 0;
    y += jy;
    // 기준: 발이 y, 몸 폭 4칸 (x-4 ~ x+4)
    if (opt.sit) {
      px(-2, -8, 4, 2, c.hair); px(-2, -6, 4, 2, c.skin); px(-3, -4, 6, 2, c.shirt); px(-3, -2, 7, 2, c.shorts);
    } else {
      px(-2, -11, 4, 2, c.hair);
      px(-2, -9, 4, 2, c.skin);
      px(-3, -7, 6, 3, c.shirt);
      const arm = f % 2 ? 1 : 0;
      px(-4, -7 + arm, 1, 2, c.skin); px(3, -7 + (1 - arm), 1, 2, c.skin);
      px(-2, -4, 4, 1, c.shorts);
      const step = [0, 1, 0, -1][f % 4];
      px(-2 + Math.min(0, step), -3, 1, 3, c.skin); px(1 + Math.max(0, step), -3, 1, 3, c.skin);
      px(-2 + Math.min(0, step), 0, 1, 1, '#222'); px(1 + Math.max(0, step), 0, 1, 1, '#222');
    }
    ctx.restore();
    if (opt.star) {
      ctx.fillStyle = '#ffe14a';
      ctx.beginPath(); ctx.moveTo(x, y - 30 + jy); ctx.lineTo(x - 4, y - 36 + jy); ctx.lineTo(x + 4, y - 36 + jy); ctx.fill();
    }
  }
  const SKIN = ['#f1c9a0', '#e0ac7e', '#c68a5e', '#8d5a3c'];
  const HAIR = ['#2a1a10', '#4a2c18', '#111', '#c08a3a', '#5a3a2a'];
  function look(i, shirt, shorts) { return { shirt, shorts, skin: SKIN[Math.floor(hash(i) * SKIN.length)], hair: HAIR[Math.floor(hash(i + 9) * HAIR.length)] }; }
  function ball(x, y, h = 0, r = 3) {
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 1, r, r * 0.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y - h - r, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.fillRect(x - 1, y - h - r - 1, 2, 2);
  }
  function label(text, x, y, color = '#fff', size = 11, bg = 'rgba(0,0,0,.55)') {
    ctx.font = `bold ${size}px "Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = bg;
    ctx.fillRect(Math.round(x - w / 2), Math.round(y - size - 2), Math.round(w), size + 5);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
  }
  function bigText(text, x, y, color, k) {
    const s = 22 + Math.sin(k * Math.PI) * 6;
    ctx.font = `900 ${s}px "Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
  }

  // ───────────────────────── 배경 ─────────────────────────
  function sky(top = '#7ec8f0', bottom = '#cfeaf7') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function ground(y, col = '#5aa845', dark = '#4a9038') {
    ctx.fillStyle = col; ctx.fillRect(0, y, W, H - y);
    ctx.fillStyle = dark;
    for (let x = 0; x < W; x += 14) ctx.fillRect(x + (hash(x) * 6 | 0), y + 3 + (hash(x + 1) * 10 | 0), 2, 2);
  }
  function pitch(top) {
    const h = H - top - 4;
    for (let i = 0; i < 12; i++) { ctx.fillStyle = i % 2 ? '#3f9a3f' : '#48a648'; ctx.fillRect(i * W / 12, top, W / 12 + 1, h); }
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2;
    ctx.strokeRect(4, top + 2, W - 8, h - 4);
    ctx.beginPath(); ctx.moveTo(W / 2, top + 2); ctx.lineTo(W / 2, top + h - 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(W / 2, top + h / 2, Math.min(40, h * 0.35), h * 0.3, 0, 0, 7); ctx.stroke();
    const bw = Math.min(90, W * 0.1);
    ctx.strokeRect(4, top + h * 0.2, bw, h * 0.6);
    ctx.strokeRect(W - 4 - bw, top + h * 0.2, bw, h * 0.6);
    // 골대
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillRect(0, top + h * 0.36, 5, h * 0.28);
    ctx.fillRect(W - 5, top + h * 0.36, 5, h * 0.28);
    return { top, h };
  }

  // ───────────────────────── 집 ─────────────────────────
  function drawHome(t) {
    const night = new Date().getHours();
    const dark = night >= 19 || night < 6;
    sky(dark ? '#1b2340' : '#8fd0f2', dark ? '#3a4466' : '#d8f0fa');
    const gy = H - 34;
    ground(gy);
    // 집 (레벨에 따라 커진다)
    const lv = S.bld.home;
    const hw = 60 + lv * 8, hh = 40 + lv * 5;
    const hx = 40;
    ctx.fillStyle = lv >= 7 ? '#f4efe6' : lv >= 4 ? '#e8d6b8' : '#c9a87a';
    ctx.fillRect(hx, gy - hh, hw, hh);
    ctx.fillStyle = lv >= 7 ? '#3a4a6a' : '#b4442f';
    ctx.beginPath(); ctx.moveTo(hx - 8, gy - hh); ctx.lineTo(hx + hw / 2, gy - hh - 24 - lv * 2); ctx.lineTo(hx + hw + 8, gy - hh); ctx.fill();
    ctx.fillStyle = '#6a4024'; ctx.fillRect(hx + hw / 2 - 7, gy - 22, 14, 22);
    ctx.fillStyle = dark ? '#ffe28a' : '#9fd8ff';
    ctx.fillRect(hx + 8, gy - hh + 10, 14, 12); ctx.fillRect(hx + hw - 22, gy - hh + 10, 14, 12);
    if (S.building) label(`🏗️ ${BUILDINGS.find((b) => b.id === S.building.id).name} 공사 중`, hx + hw / 2, gy - hh - 30 - lv * 2, '#ffd24a', 10);
    // 연습 골대
    const gx = Math.min(W - 60, hx + hw + 170);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(gx, gy + 2); ctx.lineTo(gx, gy - 30); ctx.lineTo(gx + 44, gy - 30); ctx.lineTo(gx + 44, gy + 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    for (let i = 4; i < 44; i += 6) { ctx.beginPath(); ctx.moveTo(gx + i, gy - 30); ctx.lineTo(gx + i + 4, gy - 8); ctx.stroke(); }
    // 선수
    const team = S.teamId ? TEAM_BY_ID[S.teamId] : null;
    const me = look(7, team ? team.c1 : '#e04848', team ? team.c2 : '#fff');
    const px = hx + hw + 70;
    if (injured()) {
      person(px, gy + 8, me, 0, { sit: true });
      label(`🩹 ${S.injury.name} · ${fmtSec((S.injury.until - Date.now()) / 1000)}`, px, gy - 30, '#ffb0a0', 10);
    } else {
      const k = (t / 450) % 1;
      const foot = Math.floor(t / 450) % 2;
      person(px, gy + 8, me, foot ? 1 : 0);
      ball(px + (foot ? 6 : -6), gy + 8, Math.sin(k * Math.PI) * 26 + 2, 3);
      label(S.name, px, gy - 40, '#ffe14a', 10);
    }
    // 연인
    if (S.love.partner) {
      const p = PARTNERS.find((x) => x.id === S.love.partner);
      const st = loveStage();
      const lx = hx + hw + 30;
      person(lx, gy + 8, { shirt: '#ff8ab4', shorts: '#5a6aa0', skin: SKIN[0], hair: '#3a2010' }, 0);
      if (st >= 1 && Math.floor(t / 1600) % 3 === 0) label('💕', lx + 6, gy - 30, '#fff', 12, 'rgba(0,0,0,0)');
      label(p.name, lx, gy - 16 - 22, '#ffb0d0', 9);
    }
    // 휴식 표시
    const max = stamMax();
    if (S.phase !== 'retired' && !injured() && S.stamina < max) label(`💤 휴식 중 — 가득 차기까지 ${fmtSec((max - S.stamina) / restRate())}`, W / 2 + 120, 34, '#fff', 11);
    if (S.phase === 'retired') label('🎖️ 은퇴한 선수 — 캠프에서 다음 세대를 시작하세요', W / 2, 40, '#ffd24a', 12);
  }

  // ───────────────────────── 이동 ─────────────────────────
  function drawTravel(t, toStadium, k) {
    sky('#8fd0f2', '#e0f2fa');
    const gy = H - 30;
    // 멀리 있는 산·건물
    for (let i = 0; i < 8; i++) {
      const x = ((i * 180 - t * 0.03) % (W + 200) + W + 200) % (W + 200) - 100;
      ctx.fillStyle = '#a8c8a0';
      ctx.beginPath(); ctx.moveTo(x - 90, gy); ctx.lineTo(x, gy - 50 - hash(i) * 30); ctx.lineTo(x + 90, gy); ctx.fill();
    }
    ctx.fillStyle = '#555'; ctx.fillRect(0, gy, W, 30);
    ctx.fillStyle = '#ddd';
    for (let x = -(t * 0.25 % 40); x < W; x += 40) ctx.fillRect(x, gy + 14, 20, 2);
    for (let i = 0; i < 10; i++) {
      const x = ((i * 130 - t * 0.12) % (W + 100) + W + 100) % (W + 100) - 50;
      ctx.fillStyle = '#6a4a2a'; ctx.fillRect(x, gy - 18, 4, 18);
      ctx.fillStyle = '#3f8a3a'; ctx.beginPath(); ctx.arc(x + 2, gy - 22, 10, 0, 7); ctx.fill();
    }
    const team = TEAM_BY_ID[S.teamId];
    const bx = W * (toStadium ? 0.35 : 0.5), by = gy + 8;
    ctx.fillStyle = team.c1; ctx.fillRect(bx - 50, by - 34, 100, 30);
    ctx.fillStyle = team.c2; ctx.fillRect(bx - 50, by - 16, 100, 4);
    ctx.fillStyle = '#bfe6ff'; for (let i = 0; i < 5; i++) ctx.fillRect(bx - 44 + i * 18, by - 30, 12, 10);
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(bx - 30, by - 3, 6, 0, 7); ctx.arc(bx + 30, by - 3, 6, 0, 7); ctx.fill();
    const fx = myFixture();
    const txt = toStadium && fx ? `🚌 ${fx.home ? '홈' : '원정'} 경기장으로 — vs ${TEAM_BY_ID[fx.oppId].name} (${S.season.md + 1}라운드)` : '🚌 집으로 돌아가는 중';
    label(txt, W / 2 + 100, 34, '#fff', 12);
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(W / 2 + 10, 42, 180, 4);
    ctx.fillStyle = '#ffd24a'; ctx.fillRect(W / 2 + 10, 42, 180 * k, 4);
  }

  // ───────────────────────── 경기 ─────────────────────────
  // match.js 의 재생 시간표(matchPlan)를 따라 그린다: 조용한 구간은 빠르게 공을 돌리고,
  // 장면(내 활약·골·슛)은 패스 전개 → 슛 → 결과 → 세리머니로 보여 주며 카메라가 따라가 확대한다.
  const BASE = { x: [0.03, 0.27, 0.27, 0.47, 0.63], y: [0.5, 0.26, 0.74, 0.44, 0.56] }; // 오른쪽으로 공격하는 팀 기준
  const MY_IDX = { GK: 0, DF: 1, MF: 3, FW: 4 };
  const cam = { x: 0.5, y: 0.5, z: 1 };
  let camT = 0;

  function basePos(side, i, push, t) {
    let fx = BASE.x[i], fy = BASE.y[i];
    if (i > 0) fx += push * 0.17;
    fx += Math.sin(t / 900 + i * 2 + side * 5) * 0.012;
    fy += Math.sin(t / 1300 + i * 3 + side) * 0.045;
    return side === 0 ? { x: fx, y: fy } : { x: 1 - fx, y: 1 - fy };
  }
  const lerpP = (p, q, k) => ({ x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k) });
  const seg01 = (ms, a, b) => clamp((ms - a) / Math.max(1, b - a), 0, 1);

  // 조용한 구간: 실제 시간 기준으로 0.9초마다 패스가 오간다
  function quietFrame(t) {
    const P = 900;
    const n = Math.floor(t / P), k = (t % P) / P;
    const holder = (j) => ({ side: hash(j * 1.31) < 0.5 ? 0 : 1, i: 1 + Math.floor(hash(j * 2.71) * 4) });
    const h0 = holder(n), h1 = holder(n + 1);
    const pushOf = (h) => (h.side === 0 ? 0.25 : -0.25);
    const push = lerp(pushOf(h0), pushOf(h1), ease(k));
    const pos = [[], []];
    for (let i = 0; i < 5; i++) { pos[0][i] = basePos(0, i, push, t); pos[1][i] = basePos(1, i, -push, t); }
    const p0 = pos[h0.side][h0.i], p1 = pos[h1.side][h1.i];
    const ball = { ...lerpP(p0, p1, ease(k)), h: Math.sin(k * Math.PI) * (h0.side !== h1.side ? 2 : 5) };
    return { pos, ball, poses: [[{}, {}, {}, {}, {}], [{}, {}, {}, {}, {}]], focus: { x: ball.x, y: 0.5, z: 1 } };
  }

  function sceneFrame(seg, ms, t, ctxInfo) {
    const e = seg.ev;
    const { myTeam, opp } = ctxInfo;
    const meIdx = MY_IDX[S.pos];
    let a = e.side != null ? e.side : 0;
    if (e.type === 'tackle') a = 1;
    if (e.type === 'drib') a = 0;
    const d = 1 - a;
    const F = (ax, ay) => (a === 0 ? { x: ax, y: ay } : { x: 1 - ax, y: 1 - ay }); // 공격 방향 좌표 → 경기장 좌표
    const meInv = e.who === 'me';
    const shotMs = sceneShotMs(seg);
    const shotDur = meInv ? 1100 : 600;
    const B = Math.max(500, shotMs - shotDur);
    const push = 0.2 + 0.8 * ease(clamp(ms / B, 0, 1));
    const pos = [[], []];
    for (let i = 0; i < 5; i++) { pos[a][i] = basePos(a, i, push, t); pos[d][i] = basePos(d, i, -push, t); }
    const poses = [[{}, {}, {}, {}, {}], [{}, {}, {}, {}, {}]];
    const sd = e.min * 13.7 + (e.side || 0) * 3.1;
    const laneY = 0.3 + hash(sd) * 0.4, wingY = hash(sd + 1) < 0.5 ? 0.16 : 0.84, spotY = 0.34 + hash(sd + 2) * 0.32;

    const meShoots = a === 0 && meInv && ['goal', 'miss', 'save'].includes(e.type) && e.assist !== 'me';
    const mePasses = a === 0 && (e.assist === 'me' || (e.type === 'chance' && meInv));
    const meDribbles = e.type === 'drib';
    const shooterI = meShoots ? meIdx : (a === 0 && meIdx === 4 ? 3 : 4);
    let bI = mePasses || meDribbles ? meIdx : 3;
    if (bI === shooterI) bI = shooterI === 3 ? 2 : 3;
    const aI = bI === 2 || shooterI === 2 ? 1 : 2;
    const A = pos[a][aI], Bp = pos[a][bI], Sh = pos[a][shooterI];
    // 전개: A가 몰고 → B에게 패스 → B가 몰고 → 슈터에게
    const A0 = F(0.3, laneY), A1 = F(0.38, laneY);
    const B0 = F(0.58, wingY), B1 = F(0.67, lerp(wingY, 0.5, 0.35));
    const SP = F(0.8, spotY);
    Object.assign(A, lerpP(A0, A1, seg01(ms, 0, B * 0.3)));
    Object.assign(Bp, lerpP(lerpP(Bp, B0, seg01(ms, 0, B * 0.45)), B1, seg01(ms, B * 0.45, B * 0.75)));
    Object.assign(Sh, lerpP(Sh, SP, ease(seg01(ms, 0, B))));
    const keeper = pos[d][0];
    const out = { pos, poses, ball: { x: 0.5, y: 0.5, h: 0 }, focus: { x: 0.5, y: 0.5, z: 1.1 }, trail: null, skill: null, big: null, ticker: '', confetti: false, crowd: 0, letterbox: false };
    const foot = (p) => ({ x: p.x + (a === 0 ? 0.008 : -0.008), y: p.y + 0.02, h: 0 });
    const longPass = e.skill && e.skill.fx === 'long' && mePasses;
    if (ms < B * 0.3) out.ball = foot(A);
    else if (ms < B * 0.45) { const q = seg01(ms, B * 0.3, B * 0.45); out.ball = { ...lerpP(foot(A), foot(Bp), q), h: Math.sin(q * Math.PI) * (longPass ? 18 : 4) }; }
    else if (ms < B * 0.75) out.ball = foot(Bp);
    else if (ms < B) { const q = seg01(ms, B * 0.75, B); out.ball = { ...lerpP(foot(Bp), foot(Sh), q), h: Math.sin(q * Math.PI) * (wingY < 0.2 || wingY > 0.8 ? 12 : 5) }; }
    out.focus = { x: out.ball.x, y: out.ball.y, z: 1.12 };
    const lead = a === 0
      ? (meShoots || mePasses || meDribbles ? `⚡ ${S.name}에게 공이 갑니다!` : `${myTeam.name}의 공격 전개`)
      : (e.type === 'tackle' ? `⚠️ ${opp.name} 역습 — ${S.name} 수비 가담` : `⚠️ ${opp.name}의 공격`);
    out.ticker = ms < B ? lead : (e.text || (a === 0 ? '슛! 아쉽게 빗나갑니다' : '상대 슛, 막아냈다'));

    if (e.type === 'tackle') {
      // 상대 B가 몰고 오는 공을 내가 미끄러지며 빼앗는다
      const mp = pos[0][meIdx];
      const tgt = foot(Bp);
      Object.assign(mp, lerpP(mp, { x: tgt.x - 0.02, y: tgt.y }, ease(seg01(ms, B * 0.4, B))));
      if (ms >= B * 0.45) {
        if (ms < B) out.ball = foot(Bp);
        else { out.ball = { x: mp.x + 0.03, y: mp.y + 0.02, h: 0 }; mp.x += seg01(ms, B, seg.dur) * 0.08; out.ball.x = mp.x + 0.02; }
      }
      if (ms > B - 350 && ms < B + 500) poses[0][meIdx].slide = true;
      out.focus = { x: mp.x, y: mp.y, z: ms > B - 600 ? 1.7 : 1.15 };
      out.letterbox = ms > B - 500 && ms < B + 500;
      if (e.skill) out.skill = { name: e.skill.name, at: mp, k: seg01(ms, B - 600, B + 1400) };
      if (ms > B) out.big = { text: '태클 성공!', color: '#5bb0ff', k: seg01(ms, B, B + 1600) };
      return out;
    }
    if (meDribbles) {
      // 내가 받아서 수비를 제친다 (실패하면 빼앗긴다)
      const mp = pos[0][meIdx];
      const df = pos[1][1];
      Object.assign(df, F(0.72, 0.5));
      if (ms >= B * 0.45) {
        const q = seg01(ms, B * 0.45, shotMs);
        const p = lerpP(B0, SP, q);
        mp.x = p.x; mp.y = p.y + Math.sin(q * 18) * 0.06 * (1 - q);
        out.ball = e.ok || ms < B ? foot(mp) : { x: df.x - 0.015, y: df.y + 0.02, h: 0 };
        if (!e.ok && ms > B) { df.x -= seg01(ms, B, seg.dur) * 0.1; out.ball.x = df.x - 0.015; }
      }
      out.focus = { x: mp.x, y: mp.y, z: ms > B * 0.6 ? 1.7 : 1.15 };
      out.letterbox = ms > B * 0.6 && ms < shotMs + 300;
      if (e.skill) out.skill = { name: e.skill.name, at: mp, k: seg01(ms, B * 0.5, shotMs + 1200) };
      if (ms > shotMs) out.big = e.ok ? { text: '돌파!', color: '#ffe14a', k: seg01(ms, shotMs, shotMs + 1400) } : { text: '막혔다', color: '#ff9a8a', k: seg01(ms, shotMs, shotMs + 1400) };
      return out;
    }
    // 슛
    const meKeeps = a === 1 && meInv && e.type === 'save';
    const result = e.type === 'goal' ? 'goal' : e.type === 'save' ? 'save' : e.type === 'miss' ? 'miss' : (hash(sd + 4) < 0.5 ? 'save' : 'miss');
    const ty = result === 'miss' ? (hash(sd + 5) < 0.5 ? 0.14 : 0.86) : 0.4 + hash(sd + 6) * 0.2;
    const G = F(1.0, ty);
    const fx = meShoots && e.skill ? e.skill.fx : 'normal';
    if (ms >= B) {
      const q = seg01(ms, B, shotMs);
      const S0 = foot(Sh);
      let qx = q, qy = q, hgt = Math.sin(q * Math.PI) * 6, wob = 0;
      if (fx === 'curve') qy = q * q;
      if (fx === 'chip') hgt = Math.sin(q * Math.PI) * 30;
      if (fx === 'knuckle') wob = Math.sin(q * 36) * 0.035 * q;
      if (fx === 'power') { qx = Math.min(1, q * 1.4); qy = qx; hgt = 3; }
      if (fx === 'header') hgt = 14 * (1 - q) + 4;
      if (fx === 'bicycle') hgt = 18 * (1 - q) + 3;
      out.ball = { x: lerp(S0.x, G.x, qx), y: lerp(S0.y, G.y, qy) + wob, h: hgt };
      if (fx === 'curve') out.ball.y += Math.sin(q * Math.PI) * 0.2 * (S0.y < 0.5 ? 1 : -1);
      if (fx === 'bicycle' && q < 0.5) poses[a][shooterI].dive = Math.PI * (q / 0.5);
      if (fx === 'header' && q < 0.3) poses[a][shooterI].jump = 1.5;
      keeper.y = lerp(keeper.y, ty, clamp(q * 1.3, 0, 1));
      if (q > 0.55 && result !== 'miss') poses[d][0].dive = (ty < 0.5 ? -1 : 1) * (a === 0 ? 1 : -1) * 1.2;
      if (q < 1) out.trail = { from: S0, to: out.ball, fx };
      if (q >= 1) {
        const z = seg01(ms, shotMs, shotMs + 700);
        if (result === 'goal') out.ball = { ...F(1.012, ty), h: 2 };
        else if (result === 'save') out.ball = { ...lerpP(G, F(0.86, ty + (ty < 0.5 ? 0.25 : -0.25)), z), h: Math.sin(z * Math.PI) * 10 };
        else out.ball = { ...lerpP(G, F(1.04, ty < 0.5 ? 0.02 : 0.98), z), h: 2 };
      }
    }
    const meMoment = meShoots || meKeeps;
    const slowFrom = B - 400, slowTo = shotMs + 600;
    out.focus = ms < slowFrom ? { x: out.ball.x, y: out.ball.y, z: 1.12 }
      : { x: lerp(Sh.x, G.x, 0.5), y: lerp(Sh.y, G.y, 0.5), z: meMoment ? 1.75 : result === 'goal' ? 1.4 : 1.2 };
    out.letterbox = meMoment && ms > slowFrom && ms < slowTo;
    if (meShoots && e.skill) out.skill = { name: e.skill.name, at: Sh, k: seg01(ms, B - 700, shotMs + 1200) };
    if (mePasses && e.skill) out.skill = { name: e.skill.name, at: Bp, k: seg01(ms, B * 0.6, B + 1200) };
    if (meKeeps && e.skill) out.skill = { name: e.skill.name, at: keeper, k: seg01(ms, B - 400, shotMs + 1200) };
    if (ms > shotMs) {
      const k = seg01(ms, shotMs, seg.dur);
      if (result === 'goal') {
        // 세리머니: 득점자가 코너로 달려가고 동료들이 따라간다
        const corner = F(0.94, spotY < 0.5 ? 0.06 : 0.94);
        const run = ease(seg01(ms, shotMs + 200, shotMs + 1600));
        Object.assign(Sh, lerpP(Sh, corner, run));
        for (let i = 1; i < 5; i++) if (i !== shooterI) Object.assign(pos[a][i], lerpP(pos[a][i], { x: corner.x + (hash(i) - 0.5) * 0.06, y: corner.y + (hash(i + 4) - 0.5) * 0.25 }, run * 0.8));
        poses[a][shooterI].jump = ms / 90;
        out.focus = { x: Sh.x, y: Sh.y, z: 1.4 };
        out.big = a === 0
          ? { text: 'GOAL!!', sub: e.assist === 'me' ? `${e.scorer || '동료'} · 도움 ${S.name}${e.skill ? ' (' + e.skill.name + ')' : ''}` : `${e.scorer || ''}${e.who === 'me' && e.skill ? ' · ' + e.skill.name : ''}`, color: '#ffe14a', k }
          : { text: '실점…', sub: e.scorer || '', color: '#ff9a8a', k };
        out.confetti = a === 0;
        out.crowd = a === 0 ? 1 : 0.3;
      } else if (result === 'save') {
        out.big = meKeeps ? { text: '선방!', color: '#7be07b', k } : { text: '막혔다!', color: '#cfd8e8', k };
      } else out.big = { text: '아깝다!', color: '#cfd8e8', k };
    }
    return out;
  }

  function drawCrowd(t, excite, myTeam, opp, home) {
    const cols = home ? [myTeam.c1, myTeam.c2, '#e8e0d0', myTeam.c1] : [opp.c1, opp.c2, '#e8e0d0', myTeam.c1];
    ctx.fillStyle = '#1a2233'; ctx.fillRect(0, 0, W, 24);
    for (let x = 2; x < W; x += 5) for (let r = 0; r < 3; r++) {
      const hv = hash(x * 0.37 + r * 11);
      const jump = excite > 0 ? Math.max(0, Math.sin(t / 70 + x * 0.3 + r)) * 3 * excite : 0;
      ctx.fillStyle = cols[Math.floor(hv * cols.length)];
      ctx.fillRect(x, 4 + r * 6 - jump, 3, 3);
    }
  }

  function drawMatch(t) {
    const mt = S.run.match;
    const res = mt.res;
    const myTeam = TEAM_BY_ID[S.season.teamId], opp = TEAM_BY_ID[mt.oppId];
    const elapsed = t - mt.t0;
    const clk = matchClock(res, elapsed);
    const seg = clk.seg;
    const m = clk.min;
    const sc = scoreAt(res, elapsed);
    const injuredOut = res.events.find((e) => e.type === 'injury' && e.min <= m);
    let f;
    if (seg.kind === 'scene') f = sceneFrame(seg, clk.ms, t, { myTeam, opp });
    else {
      f = quietFrame(t);
      if (seg.kind !== 'quiet') {
        for (let i = 0; i < 5; i++) { f.pos[0][i] = basePos(0, i, 0, t); f.pos[1][i] = basePos(1, i, 0, t); }
        f.ball = { x: 0.5, y: 0.5, h: 0 };
        f.focus = { x: 0.5, y: 0.5, z: 1 };
      }
    }
    // 카메라는 목표를 부드럽게 따라간다
    const dt = Math.min(0.1, (t - (camT || t)) / 1000);
    camT = t;
    const kk = Math.min(1, dt * 3.5);
    cam.x += (f.focus.x - cam.x) * kk; cam.y += (f.focus.y - cam.y) * kk; cam.z += (f.focus.z - cam.z) * kk;

    const top = 24;
    drawCrowd(t, f.crowd || 0, myTeam, opp, mt.home);
    const ph = H - top;
    const X = (fx) => 6 + fx * (W - 12);
    const Y = (fy) => top + 6 + fy * (ph - 12);
    const z = cam.z;
    const vw = W / z, vh = ph / z;
    const cx = clamp(X(cam.x), vw / 2, W - vw / 2);
    const cy = clamp(Y(cam.y), top + vh / 2, H - vh / 2);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, top, W, ph); ctx.clip();
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - cx * z), dpr * (top + ph / 2 - cy * z));
    pitch(top);
    if (f.trail) {
      const tf = f.trail.fx;
      ctx.strokeStyle = tf === 'normal' ? 'rgba(255,255,255,.35)' : tf === 'power' ? 'rgba(255,110,50,.85)' : tf === 'knuckle' ? 'rgba(160,220,255,.8)' : 'rgba(255,225,80,.8)';
      ctx.lineWidth = tf === 'power' ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(X(f.trail.from.x), Y(f.trail.from.y) - 4); ctx.lineTo(X(f.trail.to.x), Y(f.trail.to.y) - f.trail.to.h - 3); ctx.stroke();
    }
    const meIdx = MY_IDX[S.pos];
    const list = [];
    for (const side of [0, 1]) for (let i = 0; i < 5; i++) {
      const isMe = side === 0 && i === meIdx;
      if (isMe && injuredOut) continue;
      const tm = side === 0 ? myTeam : opp;
      const kit = i === 0 ? (side === 0 ? '#2a2a2a' : '#f0e040') : tm.c1;
      const p = f.pos[side][i];
      list.push({ x: X(p.x), y: Y(p.y), c: look(side * 10 + i, kit, tm.c2), isMe, pose: f.poses[side][i], flip: side === 1 });
    }
    list.sort((p, q) => p.y - q.y);
    const fr = Math.floor(t / 140);
    for (const p of list) {
      person(p.x, p.y, p.c, fr + (p.x | 0), { ...p.pose, star: p.isMe, flip: p.flip });
      if (p.isMe) label(S.name, p.x, p.y - 38, '#ffe14a', 9);
    }
    ball(X(clamp(f.ball.x, -0.02, 1.02)), Y(f.ball.y), f.ball.h, 3);
    let skillAt = null;
    if (f.skill && f.skill.k > 0 && f.skill.k < 1) skillAt = { x: X(f.skill.at.x), y: Y(f.skill.at.y) };
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 화면 고정 요소
    if (f.letterbox) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, top, W, 7); ctx.fillRect(0, H - 7, W, 7); }
    if (skillAt) {
      const sx = W / 2 + (skillAt.x - cx) * z;
      bigText(`${f.skill.name}!`, clamp(sx, 90, W - 90), top + 30, '#ffb02e', f.skill.k);
    }
    if (f.confetti) {
      for (let i = 0; i < 46; i++) {
        const x = (hash(i) * W + Math.sin(t / 400 + i) * 20) % W;
        const y = (hash(i + 7) * H + t * (0.05 + hash(i + 3) * 0.05)) % H;
        ctx.fillStyle = [myTeam.c1, myTeam.c2, '#ffe14a', '#ffffff'][i % 4];
        ctx.fillRect(x, y, 3, 5);
      }
    }
    if (f.big && f.big.k > 0 && f.big.k < 1) {
      bigText(f.big.text, W / 2, top + ph / 2 + 6, f.big.color, f.big.k);
      if (f.big.sub) label(f.big.sub, W / 2, top + ph / 2 + 26, '#fff', 12);
    }
    if (seg.kind === 'kick') bigText('킥오프!', W / 2, top + ph / 2 + 6, '#ffffff', clk.k);
    if (seg.kind === 'half') bigText(`하프타임 ${sc[0]} : ${sc[1]}`, W / 2, top + ph / 2 + 6, '#ffffff', clk.k);
    if (seg.kind === 'end') {
      const r = res.res === 'W' ? '승리!' : res.res === 'D' ? '무승부' : '패배…';
      bigText(`경기 종료 ${sc[0]} : ${sc[1]} ${r}`, W / 2, top + ph / 2 + 2, res.res === 'W' ? '#ffe14a' : '#ffffff', Math.min(clk.k, 0.5));
      label(`${S.name} 평점 ${res.me.rating.toFixed(1)}${res.me.mom ? ' · ⭐ MOM' : ''}`, W / 2, top + ph / 2 + 24, res.me.mom ? '#ffe14a' : '#fff', 12);
    }

    // 점수판 + 진행 막대
    const sbw = 320;
    ctx.fillStyle = 'rgba(8,12,22,.92)';
    ctx.fillRect(W / 2 - sbw / 2, 1, sbw, 22);
    ctx.font = 'bold 12px "Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    ctx.textAlign = 'right'; ctx.fillStyle = myTeam.c1 === '#ffffff' ? '#eee' : myTeam.c1;
    ctx.fillText(myTeam.name, W / 2 - 30, 15);
    ctx.textAlign = 'left'; ctx.fillStyle = opp.c1 === '#ffffff' ? '#eee' : opp.c1;
    ctx.fillText(opp.name, W / 2 + 30, 15);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`${sc[0]}:${sc[1]}`, W / 2, 16);
    ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#3ef08a';
    ctx.fillText(`${Math.floor(m)}'`, W / 2 + sbw / 2 - 14, 15);
    ctx.textAlign = 'left';
    const bx0 = W / 2 - sbw / 2 + 4, bw = sbw - 8;
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(bx0, 20, bw, 2);
    ctx.fillStyle = '#3ef08a'; ctx.fillRect(bx0, 20, bw * m / 90, 2);
    for (const s of matchPlan(res).segs) {
      if (s.kind !== 'scene' || s.ev.type !== 'goal' || elapsed < s.t0 + sceneShotMs(s)) continue;
      ctx.fillStyle = s.ev.side === 0 ? '#ffe14a' : '#ff6b5b';
      ctx.fillRect(bx0 + bw * s.ev.min / 90 - 2, 18, 4, 5);
    }
    // 해설 한 줄
    const tick = seg.kind === 'scene' ? f.ticker : seg.kind === 'quiet' ? '' : '';
    if (tick) label(tick, W / 2, H - 6, '#fff', 11);
    if (injuredOut) label('🚑 부상으로 교체됨', 90, H - 6, '#ffb0a0', 11);
  }

  // ───────────────────────── 승부차기 재생 ─────────────────────────
  function playDuel(duel, meIsA) { duelShow = { duel, t0: performance.now(), meIsA }; }
  function drawDuel(t) {
    const { duel, t0, meIsA } = duelShow;
    const el = (t - t0) / 1000;
    const per = 1.6;
    const idx = Math.floor(el / per);
    if (idx > duel.kicks.length + 2) { duelShow = null; return false; }
    const { top, h } = pitch(26);
    const sc = [0, 0];
    duel.kicks.slice(0, Math.min(idx, duel.kicks.length)).forEach((k) => { if (k.goal) sc[k.side]++; });
    const k = duel.kicks[Math.min(idx, duel.kicks.length - 1)];
    const q = clamp((el % per) / 0.7, 0, 1);
    const gx = W - 8, gy = top + h / 2;
    const kickerName = k.side === 0 ? duel.a : duel.b;
    const keeperName = k.side === 0 ? duel.b : duel.a;
    const cA = look(1, '#e04848', '#fff'), cB = look(2, '#3d6fd8', '#fff');
    const kickerC = k.side === 0 ? cA : cB, keeperC = k.side === 0 ? { ...cB, shirt: '#f0e040' } : { ...cA, shirt: '#f0e040' };
    const sx = W - 140;
    const ty = gy + (hash(idx) - 0.5) * h * 0.4;
    const dive = idx < duel.kicks.length && q > 0.5 ? (k.goal ? (ty < gy ? 1 : -1) : (ty < gy ? -1 : 1)) * 1.2 : 0;
    person(gx - 10, gy + 8, keeperC, 0, { dive });
    person(sx - 14 + q * 10, gy + 12, kickerC, Math.floor(t / 150));
    if (idx < duel.kicks.length) {
      const bxx = lerp(sx, gx - (k.goal ? 0 : 12), q), byy = lerp(gy + 12, ty + 12, q);
      ball(bxx, byy, Math.sin(q * Math.PI) * 6, 3);
      if (q >= 1) bigText(k.goal ? '골!' : '막았다!', W / 2, gy + 12, k.goal ? '#ffe14a' : '#7be07b', clamp((el % per - 0.7) / 0.9, 0, 1));
      label(`⚽ ${kickerName} → 🧤 ${keeperName}`, W / 2, top + h - 4, '#fff', 11);
    } else {
      const meWon = (duel.winner === 0) === meIsA;
      bigText(meWon ? '승부차기 승리!' : '승부차기 패배', W / 2, gy + 12, meWon ? '#ffe14a' : '#ff9a8a', 0.5);
    }
    ctx.fillStyle = 'rgba(10,14,24,.85)'; ctx.fillRect(W / 2 - 160, 2, 320, 22);
    ctx.font = 'bold 12px "Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.fillText(`${duel.a}  ${sc[0]} : ${sc[1]}  ${duel.b}  (승부차기)`, W / 2, 17);
    ctx.textAlign = 'left';
    return true;
  }

  function drawEmpty() {
    sky('#1b2340', '#2a3458');
    ground(H - 30, '#2f5a2f', '#284e28');
    label('⚽ 축구선수 키우기', W / 2, H / 2, '#ffe14a', 14);
  }

  function frame() {
    const t = Date.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    try {
      if (duelShow && drawDuel(performance.now())) {}
      else if (!S) drawEmpty();
      else if (S.mode === 'run' && S.run) {
        const r = S.run;
        if (r.phase === 'match' && r.match) drawMatch(t);
        else drawTravel(t, r.phase === 'travel', clamp((t - r.t0) / (TRAVEL_SEC * 1000), 0, 1));
      } else drawHome(t);
    } catch (e) { console.error(e); }
    requestAnimationFrame(frame);
  }

  return { init, playDuel };
})();
