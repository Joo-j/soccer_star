'use strict';
// 화면: HUD, 캠프 창(왼쪽 메뉴 8개), 시작 화면, 시즌 결산·드래프트·이적시장, 무소속, 자리 비운 동안, 은퇴, 발롱도르 보상.
// 스포츠 앱 카드형 — 숫자와 아이콘 위주로 보여 주고, 설명은 ? 도움말에 넣는다.
// 데스크탑 앱(electron/preload.js 의 window.soccerDesktop)이면 창 크기 조절과 마우스 통과를 함께 처리한다.

const UI = (() => {
  const $ = (id) => document.getElementById(id);
  const desktop = !!window.soccerDesktop;
  let tab = 'match';
  let campOpen = false;
  let modal = null; // 지금 떠 있는 알림 창 종류
  let dirty = true;
  let quiet = false;
  let quietBanners = [];
  const openReports = new Set();
  let rank = { sort: 'value', data: null, loading: false, err: null };
  let bd = { data: null, at: 0 };
  let inbox = null;
  let createState = null;
  let renderedAt = 0;
  let draftView = null; // { shown, timer, done }

  const TABS = [
    ['match', '🏟️', '홈'], ['train', '🏋️', '훈련'], ['skill', '✨', '스킬'], ['gear', '👟', '장비'], ['build', '🏠', '시설'],
    ['career', '🏆', '커리어'], ['star', '🌟', '스타'], ['rank', '🌍', '랭킹'],
  ];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const teamName = (id) => (TEAM_BY_ID[id] ? TEAM_BY_ID[id].name : '무소속');
  const posLabel = (p) => `${POSITIONS[p].icon} ${POSITIONS[p].name}`;
  const statName = (id, pos = S && S.pos) => (pos === 'GK' && id === 'def' ? '선방' : STAT_NAME[id]);
  // 같은 내용이면 다시 그리지 않는다 (누르는 중인 버튼이 바뀌어 클릭이 사라지지 않게)
  function setHtml(el, html) { if (el._html !== html) { el._html = html; el.innerHTML = html; } }
  let pressing = false;
  document.addEventListener('pointerdown', () => { pressing = true; });
  document.addEventListener('pointerup', () => setTimeout(() => { pressing = false; }, 0));

  // ── 작은 부품
  const help = (text) => `<span class="help" tabindex="0" data-tip="${esc(text)}">?</span>`;
  const crest = (id, big = false) => {
    const t = TEAM_BY_ID[id];
    const bg = t ? `linear-gradient(135deg, ${t.c1} 55%, ${t.c2} 55%)` : '#2a3550';
    return `<span class="crest${big ? ' lg' : ''}" style="background:${bg}"></span>`;
  };
  const pips = (n, max) => `<span class="pips">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  const tiles = (list) => `<div class="tiles">${list.map((x) => `<div class="tile ${x.cls || ''}"><div class="v">${x.v}</div><div class="k">${x.k}</div></div>`).join('')}</div>`;
  const secH = (title, tip, right = '') => `<div class="sec-h">${title}${tip ? help(tip) : ''}${right ? `<span class="r">${right}</span>` : ''}</div>`;
  const bar = (k, cls = '') => `<div class="bar ${cls}"><i style="width:${clamp(k, 0, 1) * 100}%"></i></div>`;
  const lgTag = (tier) => `<span class="tag" style="color:${LEAGUES[tier].color}">${LEAGUES[tier].icon} ${LEAGUES[tier].name}</span>`;

  // ───────────────────────── 알림 ─────────────────────────
  function toast(msg) {
    if (quiet) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 4000);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  }
  let bannerTimer = null;
  const bannerQueue = [];
  function banner(title, sub = '') {
    if (quiet) { quietBanners.push(`${title}${sub ? ' — ' + sub : ''}`); return; }
    if (desktop && !campOpen) window.soccerDesktop.notify(title, sub);
    bannerQueue.push([title, sub]);
    if (!bannerTimer) nextBanner();
  }
  function nextBanner() {
    const b = bannerQueue.shift();
    if (!b) { $('banner').classList.add('hidden'); bannerTimer = null; return; }
    $('banner').innerHTML = `<b>${esc(b[0])}</b>${b[1] ? `<span>${esc(b[1])}</span>` : ''}`;
    $('banner').classList.remove('hidden');
    bannerTimer = setTimeout(nextBanner, 3200);
  }

  // ───────────────────────── 데스크탑 창 ─────────────────────────
  function syncWindow() {
    if (!desktop) return;
    const big = campOpen || modal;
    document.body.classList.toggle('collapsed', !big);
    window.soccerDesktop.expand(!!big);
  }
  if (desktop) {
    document.body.classList.add('desktop', 'collapsed');
    document.addEventListener('mousemove', (e) => {
      const hit = e.target.closest && e.target.closest('#hud, #camp, #overlay .modal, #banner');
      window.soccerDesktop.setIgnore(!hit);
    });
  }

  // ───────────────────────── 레드닷 ─────────────────────────
  function dots() {
    if (!S || S.phase === 'retired') return {};
    const d = {};
    d.match = (S.unread || 0) > 0 || !!S.pendingEnd || !!(S.free && (S.free.tryOffer || (S.free.market && S.free.market.length)));
    d.train = STATS.some((s) => !canTrain(s.id) && S.money >= trainCost(s.id) * 2);
    d.skill = (S.lv >= STYLE_LV && !S.style) || (S.lv >= TITLE_LV && S.style && !S.title)
      || skillsFor(S.pos).some((k) => !canLearn(k.id)) || Object.keys(S.skills).some((id) => !canMaster(id));
    d.gear = Object.keys(SLOTS).some((slot) => {
      const eq = S.gear.inv.find((g) => g.id === S.gear.eq[slot]);
      return S.gear.inv.some((g) => g.slot === slot && g.grade > (eq ? eq.grade : -1));
    });
    d.build = !S.building && BUILDINGS.some((b) => !canBuild(b.id));
    d.star = (S.love.partner && S.mode === 'home' && DATES.some((x) => !canDate(x.id))) || (!S.love.partner && PARTNERS.some((p) => S.fame >= p.fame));
    d.rank = !!(bd.data && bd.data.reward);
    return d;
  }
  const dot = (on) => (on ? '<span class="dot"></span>' : '');

  // ───────────────────────── HUD ─────────────────────────
  function statusText(t = Date.now()) {
    if (S.phase === 'retired') return '🎖️ 은퇴';
    if (S.mode === 'run' && S.run) {
      const r = S.run;
      if (r.phase === 'travel') return '🚌 경기장으로';
      if (r.phase === 'back') return '🚌 귀가 중';
      const el = t - r.match.t0;
      const m = Math.floor(matchClock(r.match.res, el).min);
      const sc = scoreAt(r.match.res, el);
      return `⚽ ${m}' ${sc[0]}:${sc[1]} vs ${teamName(r.match.oppId)}`;
    }
    if (injured(t)) return `🩹 부상 ${fmtSec((S.injury.until - t) / 1000)}`;
    if (S.free) return S.free.tryOffer || (S.free.market && S.free.market.length) ? '📨 입단 제의 도착' : `📭 무소속 · 이적시장 ${fmtSec((S.free.window - t) / 1000)}`;
    if (S.pendingEnd) return '📋 시즌 결산 확인';
    if (S.stamina >= staminaCost()) return '✅ 출전 준비 완료';
    return `💤 휴식 ${fmtSec((staminaCost() - S.stamina) / restRate())}`;
  }
  function renderHud() {
    if (!S) { setHtml($('hud'), '<span style="padding:4px 8px">⚽ 축구선수 키우기</span>'); return; }
    const d = dots();
    const any = Object.values(d).some(Boolean);
    setHtml($('hud'), `
      <span class="ovr">${myOvr()}</span>
      <b>Lv ${S.lv}</b>
      <div class="bars"><div class="mini" title="스태미나"><i style="width:${S.stamina / stamMax() * 100}%"></i></div>
        <div class="mini xp" title="경험치"><i style="width:${S.exp / expReq(S.lv) * 100}%"></i></div></div>
      <span class="st">${esc(statusText())}</span>
      <span>💰 ${fmtMoney(S.money)}</span>
      ${dot(any)}`);
  }

  // ───────────────────────── 캠프 ─────────────────────────
  function openCamp(which) {
    if (!S) return;
    if (S.phase === 'retired') { showRetired(); return; }
    campOpen = true;
    if (which) tab = which;
    $('camp').classList.remove('hidden');
    if (tab === 'match') S.unread = 0;
    if (tab === 'rank') loadRank();
    dirty = true;
    renderCamp();
    syncWindow();
  }
  function closeCamp() {
    campOpen = false;
    $('camp').classList.add('hidden');
    syncWindow();
  }
  function setTab(id) {
    tab = id;
    if (id === 'match') S.unread = 0;
    if (id === 'rank') loadRank();
    $('camp-body').scrollTop = 0;
    dirty = true;
    renderCamp();
  }
  function renderCamp() {
    if (!campOpen || !S) return;
    renderedAt = Date.now();
    dirty = false;
    const team = S.teamId ? TEAM_BY_ID[S.teamId] : null;
    setHtml($('camp-who'), `${crest(S.teamId)}<div><b>${esc(S.name)}</b><small>${team ? esc(team.name) : '무소속'}${S.phase === 'school' ? ` · ${S.grade}학년` : ''} · ${S.age}세${S.gen > 1 ? ` · ${S.gen}세대` : ''}</small></div>`);
    setHtml($('camp-res'), `<span class="chip" title="돈">💰 <span class="num">${fmtMoney(S.money)}</span></span>
      <span class="chip" title="연습 노트">📓 <span class="num">${S.notes}</span></span>
      <span class="chip" title="스킬 포인트">✨ <span class="num">${S.sp}</span></span>
      <span class="chip" title="팔로워">${fameTier().icon} <span class="num">${fmtNum(S.fame)}</span></span>
      <button class="chip" data-act="myCode" title="내 선수 코드 (다른 기기에서 찾기)">🔑</button>`);
    const d = dots();
    setHtml($('nav'), TABS.map(([id, ic, name]) => `<button class="${tab === id ? 'on' : ''}" data-act="tab" data-arg="${id}"><span class="i">${ic}</span>${name}${dot(d[id])}</button>`).join('') + `<div class="ver">v${GAME_VERSION}</div>`);
    const body = $('camp-body');
    const st = body.scrollTop;
    setHtml(body, ({ match: tabHome, train: tabTrain, skill: tabSkill, gear: tabGear, build: tabBuild, career: tabCareer, star: tabStar, rank: tabRank }[tab])());
    body.scrollTop = st;
    renderFoot();
  }
  function renderFoot() {
    const max = stamMax();
    const why = canStartRun();
    let btn;
    if (S.pendingEnd) btn = `<button class="btn go" data-act="seasonEnd">📋 시즌 결산</button>`;
    else if (S.free) btn = `<button class="btn go" data-act="tab" data-arg="match">📭 무소속</button>`;
    else if (S.mode === 'run') btn = `<button class="btn" data-act="stopRun" ${S.run.stop || S.run.phase === 'back' ? 'disabled' : ''}>${S.run.stop || S.run.phase === 'back' ? '귀가 예정' : '🏠 이번 경기 후 귀가'}</button>`;
    else btn = `<button class="btn go" data-act="startRun" ${why ? 'disabled' : ''} title="${esc(why || '')}">▶ 출전</button>`;
    const fx = S.season && !S.season.done ? myFixture() : null;
    setHtml($('camp-foot'), `
      <div class="stam"><div class="row small"><b>⚡ <span class="num" style="font-size:15px">${Math.floor(S.stamina)}</span><span class="faint">/${max}</span></b>
        <span class="faint">경기당 ${staminaCost()} · ${Math.floor(S.stamina / staminaCost())}경기 가능</span></div>
        <div class="mini"><i style="width:${S.stamina / max * 100}%"></i></div></div>
      <div class="next">${fx ? `${fx.home ? '🏠 홈' : '✈️ 원정'} · <b>vs ${esc(teamName(fx.oppId))}</b> · ${fx.md + 1}R` : ''}<br>${esc(statusText())}</div>
      ${btn}`);
  }

  // ── 🏟️ 홈
  function playerCard() {
    const eff = effStats();
    const p = POSITIONS[S.pos];
    return `<div class="pcard" style="--pc:${p.color}">
      <div><div class="ovr num">${myOvr()}</div><div class="pos">${S.pos}</div></div>
      <div><div class="nm">${esc(S.name)}</div>
        <div class="meta">${crest(S.teamId)} ${esc(teamName(S.teamId))} · ${S.age}세 · ${S.foot === 'L' ? '왼발' : '오른발'}</div>
        <div class="meta" style="margin-top:4px">${S.style ? `<span class="tag g">${esc(styleOf().name)}</span>` : ''}${S.title ? ` <span class="tag y">「${esc(S.title)}」</span>` : ''} <span class="tag">Lv ${S.lv}</span> <span class="tag">${fameTier().icon} ${fameTier().name}</span></div></div>
      <div class="stats">${STATS.map((s) => `<div><span class="num" style="color:${S.special === s.id ? 'var(--gold)' : ''}">${eff[s.id]}</span><span>${statName(s.id)}</span></div>`).join('')}</div>
    </div>`;
  }
  function tabHome() {
    let h = `<div class="grid g2 sec">${playerCard()}`;
    if (S.free) h += freeCard();
    else if (S.season) {
      const sea = S.season;
      const fx = !sea.done ? myFixture() : null;
      const tbl = sortedTable();
      const pos = (id) => tbl.findIndex((r) => r.id === id) + 1;
      h += `<div class="card">${secH(`${LEAGUES[sea.tier].icon} ${sea.no}시즌 ${LEAGUES[sea.tier].name}`, '', `${sea.md}/${seasonLen()}R`)}
        ${fx ? `<div class="vs"><div class="t">${crest(sea.teamId, true)}<b>${esc(teamName(sea.teamId))}</b><span class="faint small">${sea.md ? pos(sea.teamId) + '위' : ''}</span></div>
          <div class="mid">VS</div>
          <div class="t">${crest(fx.oppId, true)}<b>${esc(teamName(fx.oppId))}</b><span class="faint small">${sea.md ? pos(fx.oppId) + '위' : ''}</span></div></div>
          <div class="small muted" style="text-align:center">${fx.home ? '🏠 홈 경기' : '✈️ 원정 경기'} · ${fx.md + 1}라운드${realsLine(fx.oppId)}</div>`
          : '<div class="muted" style="padding:20px;text-align:center">시즌 종료</div>'}
        ${bar(sea.md / seasonLen())}</div>`;
    }
    h += '</div>';
    if (S.season) {
      const my = S.season.my;
      const def = S.pos === 'GK' || S.pos === 'DF';
      h += `<div class="sec">${secH('이번 시즌')}${tiles([
        { v: my.apps, k: '경기' },
        def ? { v: my.cs, k: '클린시트', cls: 'hl' } : { v: my.g, k: '골', cls: 'hl' },
        def ? { v: S.pos === 'GK' ? my.sv : my.tk, k: S.pos === 'GK' ? '선방' : '태클' } : { v: my.a, k: '도움' },
        { v: my.apps ? (my.rs / my.apps).toFixed(2) : '-', k: '평점', cls: 'gold' },
        { v: my.mom, k: 'MOM' },
      ])}</div>`;
    }
    if (S.phase === 'school') h += scoutCard();
    if (S.contract && S.phase === 'pro' && !S.free) {
      h += `<div class="sec">${secH('계약', '계약이 끝나는 시즌 뒤 이적시장에서 재계약·이적 제의가 와요. 아무 제의도 없으면 방출돼요. 계약 중에도 더 강한 팀의 영입 제의가 올 수 있어요.')}${tiles([
        { v: fmtMoney(S.contract.salary), k: '연봉' }, { v: `${S.contract.years}년`, k: '남은 기간' }, { v: fmtMoney(marketValue()), k: '몸값', cls: 'gold' },
      ])}</div>`;
    }
    h += `<div class="sec">${secH('최근 경기', '경기를 누르면 그 경기의 주요 장면이 펼쳐져요.')}`;
    if (!S.reports.length) h += `<div class="card muted" style="text-align:center;padding:22px">아직 경기가 없어요 — 아래 <b style="color:var(--accent)">▶ 출전</b>을 눌러 보세요</div>`;
    for (const r of S.reports.slice(0, 12)) {
      const k = `${r.season}-${r.md}`;
      h += `<div class="rep" data-act="report" data-arg="${k}">
        <span class="res ${r.res}">${{ W: '승', D: '무', L: '패' }[r.res]}</span>
        <span class="sc">${r.score[0]}:${r.score[1]}</span>
        <span>${r.home ? '🏠' : '✈️'} ${esc(r.opp)} <span class="faint small">${r.season}시즌 ${r.md}R</span></span>
        <span class="rt ${r.rating >= 7.5 ? 'hi' : r.rating < 6 ? 'lo' : ''}">${r.rating.toFixed(1)}</span>
        ${r.g ? `<span>⚽${r.g > 1 ? '×' + r.g : ''}</span>` : ''}${r.a ? `<span>🅰️${r.a > 1 ? '×' + r.a : ''}</span>` : ''}${r.mom ? '<span class="tag y">MOM</span>' : ''}${r.injury ? '<span class="tag r">🚑</span>' : ''}
        <span class="gain">+${fmtMoney(r.money)}<br>👥+${fmtNum(r.fame)}${r.gear ? ` · <span class="grade${r.gear.grade}">🎁</span>` : ''}</span></div>`;
      if (openReports.has(k)) h += `<div class="replog">${r.log.map(esc).join('\n')}${r.gear ? `\n🎁 <span class="grade${r.gear.grade}">${esc(r.gear.name)}</span>` : ''}</div>`;
    }
    return h + '</div>';
  }
  function realsLine(teamId) {
    const reals = Net.realsOn(teamId);
    return reals.length ? ` · 🌍 ${reals.map((p) => esc(p.name)).slice(0, 3).join(', ')}` : '';
  }
  function scoutCard() {
    const st = schoolStats();
    const sr = st.apps >= 5 ? scoutReport() : { grade: '?', rank: '-', pick: null, wait: true };
    const p = sr.pick;
    return `<div class="sec">${secH('🎓 스카우트 평가', '고3 시즌이 끝나면 드래프트가 열려요. 고교 3년의 평점·골·도움·클린시트·수상과 OVR로 동기 80명 중 순위가 정해지고, 1라운드 1~10순위는 1부, 11~20순위는 2부, 21~30순위는 3부, 2라운드 31~40순위는 3부 팀이 뽑아요. 41위부터는 미지명이에요. 높은 순위일수록 계약금·연봉이 커요.')}
      <div class="card row"><div class="gradebig g${sr.wait ? 'D' : sr.grade}">${sr.grade}</div>
        <div style="flex:1"><div style="font-size:15px;font-weight:800">${sr.wait ? '평가 대기' : p ? `예상 ${p.round}라운드 ${p.no}순위` : '예상 미지명'}</div>
          <div class="muted small">${sr.wait ? '고교 경기를 5경기 이상 뛰면 스카우트가 평가해요' : `${p ? `${LEAGUES[p.tier].icon} ${LEAGUES[p.tier].name} · ` : ''}동기 80명 중 약 ${sr.rank}위`}</div>
          <div style="margin-top:8px">${tiles([{ v: st.apps, k: '고교 경기' }, { v: st.g, k: '골' }, { v: st.a, k: '도움' }, { v: st.apps ? st.avg.toFixed(2) : '-', k: '평점' }, { v: st.awards, k: '수상' }])}</div></div></div></div>`;
  }
  function freeCard() {
    const f = S.free;
    let h = `<div class="card">${secH('📭 무소속', '소속 팀이 없어 리그 경기에 나갈 수 없어요. 훈련·시설·스킬은 그대로 할 수 있어요. 입단 테스트(스태미나 30)에 붙으면 1년 계약을 받고, 이적시장이 열리면 그동안 실력이 오른 만큼 제의가 올 수 있어요.', f.reason ? esc(f.reason) : '')}`;
    if (f.tryOffer) {
      const t = TEAM_BY_ID[f.tryOffer.teamId];
      h += `<div class="small" style="color:var(--accent);font-weight:700;margin-bottom:6px">✅ 입단 테스트 합격!</div>${offerRow(f.tryOffer, 'signTry', null, true)}
        <button class="btn sm" data-act="declineTry" style="margin-top:6px">거절</button>`;
    } else if (f.market && f.market.length) {
      h += `<div class="small" style="color:var(--accent);font-weight:700;margin-bottom:6px">📨 이적시장 제의 ${f.market.length}건</div>`;
      f.market.forEach((o, i) => { h += offerRow(o, 'signFree', i); });
    } else {
      h += `<div class="clock"><div class="faint small">다음 이적시장까지</div><div class="num">${fmtSec((f.window - Date.now()) / 1000)}</div></div>`;
    }
    h += `<div class="sec-h" style="margin-top:10px">입단 테스트 ${help(`스태미나 ${TRYOUT_STAMINA}을 쓰고 리그를 골라 테스트를 받아요. 리그 팀들의 평균 전력보다 OVR이 높을수록 잘 붙어요.`)}</div><div class="grid" style="grid-template-columns:repeat(4,1fr)">`;
    for (let t = 1; t <= 4; t++) {
      const why = canTryout(t);
      h += `<button class="btn" data-act="tryout" data-arg="${t}" ${why ? 'disabled' : ''} title="${esc(why || '')}" style="padding:8px 4px">${LEAGUES[t].icon} ${LEAGUES[t].short}<br><span class="num" style="font-size:18px;color:var(--accent)">${Math.round(tryoutChance(t) * 100)}%</span></button>`;
    }
    h += '</div>';
    if (S.age >= 30) h += `<button class="btn sm danger" data-act="retireFree" style="margin-top:10px">🎖️ 은퇴하기</button>`;
    return h + '</div>';
  }
  // 제의 한 줄: act 는 서명 버튼 동작
  function offerRow(o, act, i, noNego = false) {
    const t = TEAM_BY_ID[o.teamId];
    return `<div class="card offer" style="margin-bottom:6px;padding:10px 12px">${crest(o.teamId, true)}
      <div><b>${esc(t.name)}</b> ${o.renew ? '<span class="tag g">재계약</span>' : ''}<div class="small">${lgTag(t.tier)} <span class="faint">전력 ${t.r} · ${o.years}년</span>${o.fee ? ` <span class="faint">· 이적료 ${fmtMoney(o.fee)}</span>` : ''}</div></div>
      <div class="acts2"><div style="text-align:right"><div class="sal">${fmtMoney(o.salary)}</div><div class="faint small">연봉</div></div>
        ${noNego || o.negotiated || i == null ? '' : `<button class="btn sm" data-act="nego" data-arg="${i}:0.15" title="받아들일 확률이 높아요">+15%</button><button class="btn sm" data-act="nego" data-arg="${i}:0.3" title="반반이에요">+30%</button>`}
        <button class="btn go" data-act="${act}" data-arg="${i ?? ''}" style="padding:7px 14px">서명</button></div></div>`;
  }

  // ── 🏋️ 훈련
  function tabTrain() {
    const eff = effStats();
    const cap = trainCap(S.bld.gym);
    const w = POSITIONS[S.pos].w;
    let h = `<div class="sec">${secH(`훈련 · OVR <span class="num" style="font-size:18px;color:var(--accent)">${myOvr()}</span>`, `돈으로 능력치를 1씩 올려요. 상한은 개인 훈련장 레벨로 올라가요. 주특기(금색)와 스타일 핵심 능력치는 훈련비가 싸요. 큰 숫자는 스타일·칭호·장비·나이를 반영한 실제 경기 능력치예요. OVR은 포지션별 가중치로 계산해요.`, `상한 <b class="num" style="font-size:15px">${cap}</b>`)}<div class="grid g3">`;
    for (const s of STATS) {
      const why = canTrain(s.id);
      const cost = trainCost(s.id);
      h += `<div class="card ${S.special === s.id ? 'sel' : ''}">
        <div class="row"><span style="font-size:20px">${s.icon}</span><div><b>${statName(s.id)}</b><div class="faint small">OVR 비중 ${Math.round((w[s.id] || 0) * 100)}%</div></div>
          <div style="margin-left:auto;text-align:right"><span class="num" style="font-size:30px">${eff[s.id]}</span><div class="faint small">기본 ${S.stats[s.id]}</div></div></div>
        <div style="margin:8px 0">${bar(S.stats[s.id] / cap, S.special === s.id ? 'gold' : '')}</div>
        <div class="row"><button class="btn sm" data-act="train" data-arg="${s.id}" ${why ? 'disabled' : ''} title="${esc(why || '')}" style="flex:1">+1 · ${fmtMoney(cost)}</button>
          <button class="btn sm" data-act="train10" data-arg="${s.id}" ${why ? 'disabled' : ''}>+10</button></div></div>`;
    }
    return h + '</div></div>';
  }

  // ── ✨ 스킬
  function tabSkill() {
    let h = `<div class="sec">${secH('플레이 스타일', `Lv ${STYLE_LV}에 하나를 골라요(바꿀 수 없어요). Lv ${TITLE_LV}에는 고른 스타일의 칭호를 받아 능력치가 더 올라요.`, S.style ? '' : `Lv ${STYLE_LV}`)}<div class="grid g3">`;
    for (const st of STYLES[S.pos]) {
      const sel = S.style === st.id;
      h += `<div class="card ${sel ? 'sel' : S.style ? 'lock' : ''}"><h4>${esc(st.name)}</h4>
        <div class="small">${Object.entries(st.mul).map(([k, v]) => `<span class="tag g">${statName(k)} +${Math.round(v * 100)}%</span>`).join(' ')}</div>
        <div class="sub" style="margin:6px 0">${esc(st.perk)}</div>
        <div class="sub">🏅 「${esc(st.title)}」</div>
        ${!S.style ? `<button class="btn sm" data-act="style" data-arg="${st.id}" ${S.lv < STYLE_LV ? 'disabled' : ''} style="margin-top:8px">선택</button>` : ''}
        ${sel && !S.title ? `<button class="btn sm" data-act="title" ${S.lv < TITLE_LV ? 'disabled' : ''} style="margin-top:8px">칭호 받기 · Lv ${TITLE_LV}</button>` : ''}</div>`;
    }
    h += `</div></div><div class="sec">${secH('스킬', `레벨이 오를 때마다 SP 1을 얻어 스킬을 배워요. 경기에서 얻는 연습 노트로 숙련도를 올리면(최대 ${SKILL_MAX}) 경기에서 더 자주, 더 강하게 터져요.`, `✨ SP <b class="num" style="font-size:15px">${S.sp}</b> · 📓 <b class="num" style="font-size:15px">${S.notes}</b>`)}<div class="grid">`;
    const KIND = { shot: ['🎯', '슈팅'], drib: ['💨', '드리블'], pass: ['🦶', '패스'], def: ['🛡️', '수비'], gk: ['🧤', '골키퍼'] };
    for (const k of skillsFor(S.pos).sort((a, b) => a.lv - b.lv)) {
      const lv = S.skills[k.id] || 0;
      const learnWhy = canLearn(k.id), masterWhy = canMaster(k.id);
      const locked = !lv && S.lv < k.lv;
      h += `<div class="card ${lv ? 'sel' : locked ? 'lock' : ''}">
        <div class="row"><span style="font-size:18px">${KIND[k.kind][0]}</span><h4 style="margin:0">${esc(k.name)}</h4><span style="margin-left:auto">${locked ? `<span class="tag">🔒 Lv ${k.lv}</span>` : `<span class="tag g">+${Math.round(skillPow(k.id, Math.max(1, lv)) * 100)}%</span>`}</span></div>
        <div class="sub" style="margin:6px 0 8px">${esc(k.desc)}</div>
        <div class="row">${lv ? pips(lv, SKILL_MAX) : ''}<span style="margin-left:auto">${lv
          ? `<button class="btn sm" data-act="master" data-arg="${k.id}" ${masterWhy ? 'disabled' : ''} title="${esc(masterWhy || '')}">숙련 📓${lv < SKILL_MAX ? skillNoteCost(lv) : '-'}</button>`
          : locked ? '' : `<button class="btn sm" data-act="learn" data-arg="${k.id}" ${learnWhy ? 'disabled' : ''} title="${esc(learnWhy || '')}">배우기 ✨1</button>`}</span></div></div>`;
    }
    return h + '</div></div>';
  }

  // ── 👟 장비
  function tabGear() {
    let h = `<div class="sec">${secH('착용', '강화 단계는 장비가 아니라 부위에 붙어요. 장비를 바꿔 껴도 강화는 그대로예요. +6부터는 실패하면 1단계 내려가요.')}<div class="grid g3">`;
    for (const slot in SLOTS) {
      const sl = SLOTS[slot];
      const g = S.gear.inv.find((x) => x.id === S.gear.eq[slot]);
      const enh = S.gear.enh[slot];
      const info = enhanceInfo(enh);
      const gs = g ? gearStat(g, enh) : null;
      h += `<div class="card ${g ? 'bgrade' + g.grade : ''}" style="text-align:center"><div style="font-size:30px">${sl.icon}</div>
        <div class="num" style="font-size:22px;color:var(--accent)">+${enh}</div>
        <div>${g ? `<b class="grade${g.grade}">${esc(g.name)}</b>` : `<span class="faint">${sl.name} 없음</span>`}</div>
        <div class="sub">${gs ? `${statName(sl.main)} +${gs.main} · ${statName(sl.sub)} +${gs.sub}` : `${statName(sl.main)} · ${statName(sl.sub)}`}</div>
        <button class="btn sm" data-act="enhance" data-arg="${slot}" ${enh >= ENH_MAX || S.money < info.cost ? 'disabled' : ''} style="margin-top:8px;width:100%">
          ${enh >= ENH_MAX ? 'MAX' : `강화 ${fmtMoney(info.cost)} · ${Math.round(info.rate * 100)}%`}</button></div>`;
    }
    h += `</div></div><div class="sec">${secH(`가방 ${S.gear.inv.length}/${INV_MAX}`, '경기가 끝나면 가끔 장비 상자가 나와요. 높은 리그일수록, MOM일수록 좋은 장비가 나와요. 가방이 차면 새 장비는 자동으로 팔려요.',
      `<button class="btn sm" data-act="autoEquip">자동 장착</button> <button class="btn sm" data-act="sellBelow" data-arg="1">고급 이하 판매</button> <button class="btn sm" data-act="sellBelow" data-arg="2">희귀 이하 판매</button>`)}<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">`;
    const eqIds = Object.values(S.gear.eq);
    for (const g of S.gear.inv.slice().sort((a, b) => b.grade - a.grade || a.slot.localeCompare(b.slot))) {
      const on = eqIds.includes(g.id);
      const gs = gearStat(g, 0);
      h += `<div class="card bgrade${g.grade} ${on ? 'sel' : ''}" style="padding:10px"><div class="row"><span style="font-size:20px">${SLOTS[g.slot].icon}</span><div><b class="grade${g.grade} small">${esc(g.name)}</b><div class="faint small">${GRADES[g.grade].name} · ${statName(SLOTS[g.slot].main)}+${gs.main}</div></div></div>
        <div class="row" style="margin-top:6px">${on ? '<span class="tag g">착용 중</span>' : `<button class="btn sm" data-act="equip" data-arg="${g.id}">착용</button><button class="btn sm" data-act="sell" data-arg="${g.id}" title="판매">💰${fmtMoney(sellPrice(g))}</button>`}</div></div>`;
    }
    if (!S.gear.inv.length) h += '<div class="card faint" style="text-align:center">가방이 비어 있어요</div>';
    return h + '</div></div>';
  }

  // ── 🏠 시설
  function tabBuild() {
    let h = `<div class="sec">${secH('시설', '한 번에 한 곳만 지을 수 있어요. 경기에 나가 있거나 앱을 꺼 둬도 공사는 계속돼요.')}`;
    if (S.building) {
      const b = BUILDINGS.find((x) => x.id === S.building.id);
      const total = buildSec(S.bld[b.id]) * 1000;
      const left = S.building.until - Date.now();
      h += `<div class="card sel" style="margin-bottom:10px"><div class="row"><span style="font-size:22px">🏗️</span><b>${b.name} Lv ${S.bld[b.id] + 1}</b><span class="num" style="margin-left:auto;font-size:18px">${fmtSec(left / 1000)}</span></div><div style="margin-top:8px">${bar(1 - left / total)}</div></div>`;
    }
    h += '<div class="grid g2">';
    for (const b of BUILDINGS) {
      const lv = S.bld[b.id];
      const why = canBuild(b.id);
      h += `<div class="card"><div class="row"><span style="font-size:30px">${b.icon}</span><div><h4 style="margin:0">${b.name}</h4>${pips(lv, b.max)}</div><span class="num" style="margin-left:auto;font-size:24px">Lv ${lv}</span></div>
        <div class="small" style="margin:8px 0">${esc(b.desc(lv))}${lv < b.max ? `<br><span style="color:var(--accent)">→ ${esc(b.desc(lv + 1))}</span>` : ''}</div>
        ${lv < b.max ? `<button class="btn sm" data-act="build" data-arg="${b.id}" ${why ? 'disabled' : ''} title="${esc(why || '')}" style="width:100%">짓기 ${fmtMoney(buildCost(lv))} · ⏱ ${fmtSec(buildSec(lv))}</button>` : '<span class="tag g">MAX</span>'}</div>`;
    }
    return h + '</div></div>';
  }

  // ── 🏆 커리어
  function tabCareer() {
    let h = '';
    const c = S.career;
    h += `<div class="sec">${secH('통산')}${tiles([
      { v: c.apps, k: '경기' }, { v: c.goals, k: '골', cls: 'hl' }, { v: c.assists, k: '도움' }, { v: c.mom, k: 'MOM' },
      { v: c.trophies.length, k: '트로피', cls: 'gold' }, { v: c.awards.length, k: '개인상', cls: 'gold' },
    ])}</div>`;
    if (c.draft) h += `<div class="sec">${secH('드래프트')}<div class="card small">${c.draft.pick ? `🎓 ${c.draft.round}라운드 ${c.draft.pick}순위 · ${esc(teamName(c.draft.teamId))}` : '🎓 미지명 → 입단 테스트로 프로 입문'} <span class="faint">(동기 80명 중 ${c.draft.rank}위)</span></div></div>`;
    if (S.season) {
      const sea = S.season;
      const tbl = sortedTable();
      h += `<div class="sec">${secH(`${LEAGUES[sea.tier].icon} ${LEAGUES[sea.tier].name} 순위`, '🌍 표시는 그 팀에 있는 실제 플레이어 수예요.')}<div class="card" style="padding:4px 8px"><table class="t"><tr><th>#</th><th class="l">팀</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득실</th><th>승점</th></tr>`;
      tbl.forEach((r, i) => {
        const reals = Net.realsOn(r.id);
        h += `<tr class="${r.id === sea.teamId ? 'me' : ''}"><td>${i + 1}</td><td class="l">${crest(r.id)} ${esc(teamName(r.id))}${reals.length ? ` <span class="tag" title="${esc(reals.map((p) => p.name).join(', '))}">🌍${reals.length}</span>` : ''}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b class="num" style="font-size:14px">${r.pts}</b></td></tr>`;
      });
      h += '</table></div></div>';
      const list = Object.values(sea.ai).map((x) => ({ ...x })).concat([{ name: S.name, teamId: sea.teamId, g: sea.my.g, a: sea.my.a, me: true }]);
      const rk = (f, unit) => list.slice().sort((x, y) => y[f] - x[f]).slice(0, 5).map((p, i) => `<tr class="${p.me ? 'me' : ''}"><td>${i + 1}</td><td class="l">${esc(p.name)} <span class="faint">${esc(teamName(p.teamId))}</span></td><td><b>${p[f]}</b>${unit}</td></tr>`).join('');
      h += `<div class="grid g2 sec"><div class="card" style="padding:8px">${secH('⚽ 득점')}<table class="t">${rk('g', '')}</table></div><div class="card" style="padding:8px">${secH('🅰️ 도움')}<table class="t">${rk('a', '')}</table></div></div>`;
    }
    if (c.trophies.length || c.awards.length) h += `<div class="sec">${secH('트로피 · 개인상')}<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">${c.trophies.map((x) => `<div class="card small">🏆 ${esc(x)}</div>`).concat(c.awards.map((x) => `<div class="card small">${x.includes('발롱도르') ? '🥇' : '🏅'} ${esc(x)}</div>`)).join('')}</div></div>`;
    if (c.history.length) {
      h += `<div class="sec">${secH('시즌별 기록')}<div class="card" style="padding:4px 8px"><table class="t"><tr><th>시즌</th><th>나이</th><th class="l">팀</th><th>리그</th><th>순위</th><th>경기</th><th>골</th><th>도움</th><th>평점</th></tr>`;
      for (const r of c.history.slice().reverse()) h += `<tr><td>${r.no}</td><td>${r.age}</td><td class="l">${esc(r.team)}</td><td>${LEAGUES[r.tier].icon}</td><td>${r.rank}</td><td>${r.apps}</td><td>${r.g}</td><td>${r.a}</td><td>${r.avg.toFixed(2)}</td></tr>`;
      h += '</table></div></div>';
    }
    if (S.legends && S.legends.length) {
      h += `<div class="sec">${secH('🎖️ 가문의 전설')}`;
      for (const l of S.legends) h += `<div class="card small" style="margin-bottom:6px">${l.gen}세대 ${posLabel(l.pos)}${l.title ? ` 「${esc(l.title)}」` : ''} — ${l.apps}경기 ${l.goals}골 ${l.assists}도움 · 🏆${l.trophies} 🏅${l.awards} · ${l.age}세 은퇴</div>`;
      h += '</div>';
    }
    return h;
  }

  // ── 🌟 스타
  function tabStar() {
    const ft = fameTier();
    const next = FAME_TIERS.find((x) => x.min > S.fame);
    let h = `<div class="grid g2 sec"><div class="card"><div class="row"><span style="font-size:36px">${ft.icon}</span><div><div class="faint small">팔로워</div><div class="num" style="font-size:30px">${fmtNum(S.fame)}</div></div>
        <div style="margin-left:auto;text-align:right"><b>${ft.name}</b><div class="faint small">${next ? `다음 ${next.icon} ${fmtNum(next.min)}` : '최고 단계'}</div></div></div>
        ${next ? `<div style="margin-top:10px">${bar(S.fame / next.min, 'gold')}</div>` : ''}</div>
      <div class="card"><div class="faint small">몸값 ${help('OVR·나이·팔로워로 정해져요. 랭킹의 몸값 순위에 쓰여요.')}</div><div class="num" style="font-size:30px;color:var(--gold)">${fmtMoney(marketValue())}</div>
        <div class="faint small">스폰서 수입 경기당 ${fmtMoney(sponsorPay())}</div></div></div>`;
    h += `<div class="sec">${secH('🤝 스폰서', '팔로워가 기준을 넘으면 자동으로 계약해요. 경기마다 수입이 들어오고 계약 선물로 장비를 줘요.')}<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">`;
    for (const sp of SPONSORS) {
      const has = S.sponsors.includes(sp.id);
      h += `<div class="card ${has ? 'sel' : 'lock'}"><b class="small">${esc(sp.name)}</b><div class="num" style="font-size:18px;color:${has ? 'var(--accent)' : ''}">${fmtMoney(sp.pay)}<span class="faint small">/경기</span></div>
        <div class="faint small">${has ? '계약 중' : `🔒 팔로워 ${fmtNum(sp.fame)}`}</div></div>`;
    }
    h += '</div></div>';
    if (S.love.partner) {
      const p = PARTNERS.find((x) => x.id === S.love.partner);
      const st = loveStage();
      h += `<div class="sec">${secH('💕 연애', '데이트로 호감을 올리면 썸 → 연애 → 약혼 → 결혼으로 이어져요. 연애 중이면 휴식이 15%, 결혼하면 25% 빨라져요. 6시간 넘게 연락이 없으면 호감이 줄고, 0이 되면 이별해요(결혼 뒤에는 줄지 않아요).')}
        <div class="card"><div class="row"><span style="font-size:40px">${p.emoji}</span><div><h4 style="margin:0">${p.name}</h4><div class="faint small">${p.job} · 좋아하는 것: ${esc(p.like)}</div></div>
          <div style="margin-left:auto;text-align:right"><span class="num" style="font-size:26px;color:#ff9cc4">${Math.round(S.love.aff)}</span><span class="faint">/100</span></div></div>
          <div style="margin:8px 0">${bar(S.love.aff / 100, 'pink')}</div>
          <div class="steps">${LOVE_STAGES.map((x, i) => `<span class="${i <= st ? 'on' : ''}">${x.name}</span>`).join('')}</div>
          <div class="acts">${DATES.map((d) => { const why = canDate(d.id); return `<button data-act="date" data-arg="${d.id}" ${why ? 'disabled' : ''} title="${esc(why || '')}"><span class="i">${d.icon}</span>${d.name}<span class="faint">${why && why.includes('뒤에') ? why.replace(' 뒤에', '') : d.cost ? fmtMoney(d.cost) : '무료'}</span></button>`; }).join('')}</div>
          <div style="margin-top:10px;text-align:right"><button class="btn sm danger" data-act="breakup">헤어지기</button></div></div></div>`;
    } else {
      h += `<div class="sec">${secH('💕 만남', '인기가 오를수록 만날 수 있는 사람이 늘어나요. 한 번에 한 사람만 만날 수 있어요.')}<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">`;
      for (const p of PARTNERS) {
        const ok = S.fame >= p.fame;
        h += `<div class="card ${ok ? '' : 'lock'}" style="text-align:center"><div style="font-size:34px">${p.emoji}</div><b>${p.name}</b><div class="faint small">${p.job}</div>
          <button class="btn sm" data-act="meet" data-arg="${p.id}" ${ok ? '' : 'disabled'} style="margin-top:8px">${ok ? '만나 보기' : `🔒 ${fmtNum(p.fame)}`}</button></div>`;
      }
      h += '</div></div>';
    }
    return h;
  }

  // ── 🌍 랭킹
  async function loadRank() {
    rank.loading = true; rank.err = null;
    try {
      const [r, b, ib] = await Promise.all([Net.ranking(rank.sort), Net.ballondor(), Net.inbox().catch(() => null)]);
      rank.data = r; bd = { data: b, at: Date.now() }; inbox = ib;
    } catch (e) { rank.err = e.message; }
    rank.loading = false;
    dirty = true;
    renderCamp();
  }
  function tabRank() {
    let h = '';
    const b = bd.data;
    if (b && b.reward) h += `<div class="card sel sec row">🏆 지난 발롱도르 시즌 <b>${b.reward.rank}위</b>!<button class="btn go" data-act="claimBd" style="margin-left:auto">보상 받기</button></div>`;
    h += `<div class="sec">${secH('🥇 발롱도르', '3일마다 서버의 모든 선수 중 최고를 뽑아요. 이 기간의 골·도움·MOM·클린시트·평점에 리그 가중치(고교 ×0.3 ~ 월드 ×1.4)를 곱한 점수예요. 1~10위는 다음 접속 때 상금과 팔로워를 받아요.', b ? `시즌 ${b.period + 1} · ⏱ ${fmtSec((b.endsAt - Date.now()) / 1000)}` : '')}`;
    if (b) {
      const top = b.standings;
      if (top.length) {
        const pod = (x, i) => x ? `<div class="card ${i === 0 ? 'p1' : ''} ${x.name === S.name ? 'sel' : ''}"><div class="medal">${['🥇', '🥈', '🥉'][i]}</div><b>${esc(x.name)}</b><div class="faint small">${esc(x.team || '')}</div><div class="num" style="font-size:22px;color:var(--gold)">${x.pts}</div><div class="faint small">⚽${x.g} 🅰️${x.a} · ${x.avg}</div></div>` : '<div></div>';
        h += `<div class="podium">${pod(top[1], 1)}${pod(top[0], 0)}${pod(top[2], 2)}</div>`;
        if (top.length > 3) {
          h += `<div class="card" style="padding:4px 8px"><table class="t">`;
          top.slice(3, 15).forEach((x, i) => { h += `<tr class="${x.name === S.name ? 'me' : ''}"><td>${i + 4}</td><td class="l">${esc(x.name)} ${POSITIONS[x.pos] ? POSITIONS[x.pos].icon : ''}</td><td class="l faint">${esc(x.team || '')}</td><td>⚽${x.g}</td><td>🅰️${x.a}</td><td>${x.avg}</td><td><b>${x.pts}</b></td></tr>`; });
          h += '</table></div>';
        }
      } else h += '<div class="card faint" style="text-align:center">아직 이번 시즌 기록이 없어요 — 경기를 뛰면 순위에 올라요</div>';
      const winners = b.finals.filter((f) => f.top[0]);
      if (winners.length) h += `<div class="small faint" style="margin-top:8px">역대: ${winners.map((f) => `시즌 ${f.period + 1} 🥇${esc(f.top[0].name)}`).join(' · ')}</div>`;
    } else if (rank.loading) h += '<div class="card faint">불러오는 중…</div>';
    h += `</div><div class="sec">${secH('선수 랭킹', '🥅 도전: 두 선수의 슈팅·선방 능력으로 서버가 5번씩 차서 결과를 정해요. 이기면 상대의 승부차기 점수를 가져와요(발롱도르와 같은 3일 주기로 초기화).')}
      <div class="chips">${[['value', '💰 몸값'], ['ovr', '📈 OVR'], ['fame', '👥 팔로워'], ['goals', '⚽ 통산 골'], ['elo', '🥅 승부차기']].map(([k, n]) => `<button class="${rank.sort === k ? 'on' : ''}" data-act="rankSort" data-arg="${k}">${n}</button>`).join('')}</div>`;
    if (rank.loading && !rank.data) h += '<div class="card faint">불러오는 중… (서버가 잠들어 있으면 1분쯤 걸려요)</div>';
    if (rank.err) h += `<div class="err">${esc(rank.err)} <button class="btn sm" data-act="reloadRank">다시 시도</button></div>`;
    if (rank.data) {
      h += `<div class="card" style="padding:4px 8px"><table class="t"><tr><th>#</th><th class="l">선수</th><th class="l">팀</th><th>OVR</th><th>몸값</th><th>팔로워</th><th>골</th><th>승부차기</th><th></th></tr>`;
      rank.data.list.forEach((p, i) => {
        h += `<tr class="${p.name === S.name ? 'me' : ''}"><td>${i + 1}</td><td class="l">${esc(p.name)} ${POSITIONS[p.pos] ? POSITIONS[p.pos].icon : ''}${p.retired ? ' <span class="tag">은퇴</span>' : ''}</td>
          <td class="l faint">${p.tier != null ? LEAGUES[p.tier].icon : '📭'} ${esc(p.teamName || '무소속')}</td><td><b class="num" style="font-size:14px">${p.ovr}</b></td><td>${fmtMoney(p.value)}</td><td>${fmtNum(p.fame)}</td><td>${p.goals}</td><td>${p.elo} <span class="faint">${p.w}-${p.l}</span></td>
          <td>${p.name !== S.name ? `<button class="btn sm" data-act="duel" data-arg="${esc(p.name)}">🥅</button>` : ''}</td></tr>`;
      });
      h += '</table></div>';
    }
    h += '</div>';
    if (inbox && inbox.list.length) {
      h += `<div class="sec">${secH('받은 도전')}`;
      for (const d of inbox.list.slice(0, 8)) h += `<div class="rep" style="cursor:default"><span class="res ${d.winner === 1 ? 'W' : 'L'}">${d.winner === 1 ? '승' : '패'}</span><span class="sc">${d.score[1]}:${d.score[0]}</span><span>${esc(d.a)}의 도전</span><span class="gain">${d.winner === 1 ? '+' : '-'}${Math.abs(d.delta)}점</span></div>`;
      h += '</div>';
    }
    return h;
  }

  // ───────────────────────── 알림 창 공통 ─────────────────────────
  function showModal(kind, html) {
    modal = kind;
    $('modal').className = `panel modal${kind === 'start' || kind === 'create' ? ' hero-modal' : ''}`;
    $('modal').innerHTML = html;
    $('overlay').classList.remove('hidden');
    syncWindow();
  }
  function closeModal() {
    modal = null;
    $('overlay').classList.add('hidden');
    syncWindow();
  }

  // ── 시작 화면: 로고와 닉네임 칸 하나
  function showStart(err = '') {
    createState = { name: '', pos: 'FW', foot: 'R', special: 'sho', nextGen: false, accountMade: false };
    showModal('start', `<div class="hero">
      <div class="logo"><span class="ball">⚽</span><div><div class="en">SOCCER STAR</div><div class="ko">축구선수 키우기</div></div></div>
      <div class="namebox"><input id="in-name" maxlength="12" placeholder="선수 이름" autocomplete="off" spellcheck="false"><button class="btn go" data-act="startName">시작</button></div>
      <div class="err" id="name-err">${esc(err)}</div>
      <div class="faint small">한글·영문·숫자 2~12자 · 랭킹에 이 이름으로 올라가요</div>
      <button class="linkbtn" data-act="showFind">🔑 코드로 내 선수 찾기</button>
      <div class="findbox hidden" id="findbox">
        <div class="namebox"><input id="in-rname" placeholder="선수 이름" autocomplete="off" spellcheck="false"><input id="in-rcode" placeholder="코드" autocomplete="off" spellcheck="false" style="max-width:130px"><button class="btn" data-act="recover">불러오기</button></div>
        <div class="err" id="rec-err"></div>
      </div>
    </div>`);
    setTimeout(() => $('in-name') && $('in-name').focus(), 50);
  }
  async function startName() {
    const name = $('in-name').value.trim();
    const errEl = $('name-err');
    if (!/^[가-힣A-Za-z0-9_]{2,12}$/.test(name)) { errEl.textContent = '한글·영문·숫자 2~12자로 지어 주세요'; return; }
    if (errEl.dataset.busy) return;
    errEl.dataset.busy = '1';
    errEl.innerHTML = '<span class="faint">확인 중…</span>';
    try {
      const r = await Net.checkName(name);
      if (!r.ok) { errEl.textContent = r.reason; return; }
      // 이 기기에 이 이름의 선수가 있으면(서버가 초기화된 경우) 다시 등록하고 그대로 이어서 한다
      const local = loadLocal(name);
      if (local) {
        await Net.createAccount(name);
        S = local;
        closeModal();
        enterGame();
        banner('👋 다시 만나요', `${name} — 이 기기에 있던 기록으로 이어서 해요`);
        return;
      }
    } catch (e) { errEl.textContent = e.message; return; } finally { delete errEl.dataset.busy; }
    createState.name = name;
    showCreate();
  }
  async function recoverAcc() {
    const name = $('in-rname').value.trim(), code = $('in-rcode').value.trim();
    const errEl = $('rec-err');
    if (!name || !code) { errEl.textContent = '선수 이름과 코드를 넣어 주세요'; return; }
    errEl.innerHTML = '<span class="faint">찾는 중…</span>';
    try { await Net.recover(name, code); } catch (e) { errEl.textContent = e.message; return; }
    location.reload();
  }
  function showMyCode() {
    showModal('code', `<h2>🔑 내 선수 코드</h2><p class="lead">다른 기기나 데스크탑 앱 첫 화면의 <b>코드로 내 선수 찾기</b>에 선수 이름과 이 코드를 넣으면 이어서 할 수 있어요.</p>
      <div class="card sel" style="text-align:center;padding:18px;margin-bottom:14px"><div class="faint small">${esc(S.name)}</div><div class="num" style="font-size:44px;letter-spacing:.12em;color:var(--accent)">${esc(Net.myCode() || '----')}</div></div>
      <button class="btn go" data-act="closeModal">닫기</button>`);
  }

  // ── 선수 만들기: 왼쪽에서 고르면 오른쪽 카드에 시작 능력치가 바로 보인다
  function showCreate() {
    const cs = createState;
    const legacy = cs.nextGen ? Math.min(16, legacyBonus()) : 0;
    const p = POSITIONS[cs.pos];
    const st = { ...p.start };
    st[cs.special] += 4;
    for (const k in st) st[k] += legacy;
    const posCards = Object.entries(POSITIONS).map(([id, x]) => `<button class="pos ${cs.pos === id ? 'on' : ''}" data-act="cPos" data-arg="${id}" style="--pc:${x.color}"><span class="ic">${x.icon}</span><b>${x.name}</b><span class="code">${id}</span></button>`).join('');
    const statChips = STATS.map((s) => `<button class="${cs.special === s.id ? 'on' : ''}" data-act="cSpecial" data-arg="${s.id}">${s.icon} ${statName(s.id, cs.pos)}</button>`).join('');
    showModal('create', `<div class="create">
      <div class="pick">
        <div class="step">${cs.nextGen ? `🎖️ ${S.gen + 1}세대` : '🏫 고등학교 입학'}</div>
        <h2>${esc(cs.name)}</h2>
        <div class="lbl">포지션</div><div class="posrow">${posCards}</div>
        <div class="lbl">주발</div><div class="chips"><button class="${cs.foot === 'R' ? 'on' : ''}" data-act="cFoot" data-arg="R">오른발</button><button class="${cs.foot === 'L' ? 'on' : ''}" data-act="cFoot" data-arg="L">왼발</button></div>
        <div class="lbl">주특기 ${help('고른 능력치는 +4로 시작하고 훈련비가 40% 싸요.')}</div><div class="chips">${statChips}</div>
      </div>
      <div class="preview">
        <div class="pcard" style="--pc:${p.color}">
          <div><div class="ovr num">${ovrOf(st, cs.pos)}</div><div class="pos">${cs.pos}</div></div>
          <div><div class="nm">${esc(cs.name)}</div><div class="meta">${p.name} · ${cs.foot === 'L' ? '왼발' : '오른발'} · 16세</div>${legacy ? `<div class="meta" style="color:var(--gold)">전설의 피 +${legacy}</div>` : ''}</div>
          <div class="stats">${STATS.map((s) => `<div><span class="num" style="color:${cs.special === s.id ? 'var(--gold)' : ''}">${st[s.id]}</span><span>${statName(s.id, cs.pos)}</span></div>`).join('')}</div>
        </div>
        <div class="faint small" style="margin:10px 2px 14px">${p.desc}</div>
        <button class="btn go" data-act="cDone" style="width:100%">⚽ 입학하기</button>
        <div class="err" id="c-err"></div>
      </div>
    </div>`);
  }
  async function createDone() {
    const cs = createState;
    const errEl = $('c-err');
    if (cs.nextGen) {
      startNextGen(cs.pos, cs.foot, cs.special);
      closeModal();
      banner(`🏫 ${S.gen}세대 ${TEAM_BY_ID[S.teamId].name} 입학`, `${posLabel(S.pos)} · 모든 능력치 +${S.legacy}`);
      saveLocal(); Net.sync(true);
      return;
    }
    if (!cs.accountMade) {
      errEl.textContent = '계정 만드는 중…';
      try { await Net.createAccount(cs.name); cs.accountMade = true; } catch (e) { errEl.textContent = e.message; return; }
    }
    S = newSave(cs.name, cs.pos, cs.foot, cs.special);
    newSeason(pick(teamsOfTier(0)).id);
    saveLocal();
    closeModal();
    enterGame(true);
    banner(`🏫 ${TEAM_BY_ID[S.teamId].name} 입학!`, `${posLabel(S.pos)} — HUD를 눌러 캠프를 열고 ▶ 출전`);
  }
  // ── 시즌 결산 (+ 이적시장)
  function seasonSummary(pe) {
    const lg = LEAGUES[pe.tier];
    const def = S.pos === 'GK' || S.pos === 'DF';
    let h = `<div class="row" style="margin-bottom:12px">${crest(pe.teamId, true)}<div><h2>${pe.no}시즌 결산</h2><div class="muted small">${lg.icon} ${lg.name} · ${esc(teamName(pe.teamId))}</div></div>
      <div style="margin-left:auto;text-align:right"><div class="num" style="font-size:40px;line-height:1;color:${pe.rank === 1 ? 'var(--gold)' : 'var(--text)'}">${pe.rank}<span style="font-size:18px">위</span></div></div></div>
      ${tiles([{ v: pe.my.apps, k: '경기' }, def ? { v: pe.my.cs, k: '클린시트', cls: 'hl' } : { v: pe.my.g, k: '골', cls: 'hl' }, { v: pe.my.a, k: '도움' }, { v: pe.avg.toFixed(2), k: '평점', cls: 'gold' }, { v: pe.my.mom, k: 'MOM' }])}
      <div class="sec" style="margin-top:14px">${secH('🏅 시상')}`;
    for (const a of pe.awards) h += a.me
      ? `<div class="card sel small" style="margin-bottom:4px">🏅 <b style="color:var(--accent)">${esc(a.name)}</b> — ${esc(S.name)}</div>`
      : `<div class="small faint" style="padding:2px 4px">${esc(a.name)} · ${esc(a.who)} ${a.val ? `(${a.val})` : ''}</div>`;
    if (pe.rewardMoney || pe.rewardFame) h += `<div class="small" style="margin-top:6px">💰 상금 ${fmtMoney(pe.rewardMoney)} · 👥 +${fmtNum(pe.rewardFame)}</div>`;
    return h + '</div>';
  }
  function showSeasonEnd() {
    const pe = S.pendingEnd;
    if (!pe) return;
    if (pe.draft) { showDraft(); return; }
    let h = seasonSummary(pe);
    if (pe.mustRetire) {
      h += `<div class="sec">${secH('은퇴')}<div class="card">40세 — 이제 그라운드를 떠날 시간이에요.</div></div><button class="btn go" data-act="retire">🎖️ 은퇴식</button>`;
    } else if (pe.schoolNext) {
      h += `<div class="sec">${scoutMini()}</div><button class="btn go" data-act="resolve" data-arg="school">🏫 ${S.grade + 1}학년 시작</button>`;
    } else {
      const m = pe.market;
      h += `<div class="sec">${secH(`📨 이적시장`, '시즌이 끝날 때마다 열려요. 계약이 끝났으면 재계약·다른 팀 제의 중에서 고르고, 아무 제의도 없으면 방출돼요. 계약 중이면 더 강한 팀의 영입 제의만 오고 거절할 수 있어요. 제의마다 한 번 연봉 인상을 요구할 수 있어요(+15%는 잘 받아 주고 +30%는 반반).',
        m.under ? `계약 ${S.contract.years}년 남음` : '계약 만료')}`;
      if (m.offers.length) m.offers.forEach((o, i) => { h += offerRow(o, 'accept', i); });
      else h += `<div class="card" style="text-align:center;padding:18px">${m.under ? '📭 영입 제의가 없어요' : '📭 <b>어느 팀에서도 연락이 없어요…</b><div class="faint small" style="margin-top:4px">방출되면 무소속으로 훈련하며 입단 테스트나 다음 이적시장을 노려야 해요</div>'}</div>`;
      h += '</div><div class="row">';
      if (m.under) h += `<button class="btn go" data-act="resolve" data-arg="stay">✋ ${esc(teamName(S.teamId))} 잔류</button>`;
      else if (!m.offers.length) h += `<button class="btn go" data-act="resolve" data-arg="release">📭 무소속으로</button>`;
      if (pe.canRetire) h += `<button class="btn danger" data-act="retire" style="margin-left:auto">🎖️ 은퇴</button>`;
      h += '</div>';
    }
    showModal('season', h);
  }
  function scoutMini() {
    if (schoolStats().apps < 5) return '';
    const sr = scoutReport();
    return `<div class="card row"><div class="gradebig g${sr.grade}" style="font-size:44px;width:56px">${sr.grade}</div><div><b>스카우트 평가</b><div class="muted small">${sr.pick ? `예상 ${sr.pick.round}라운드 ${sr.pick.no}순위 · ${LEAGUES[sr.pick.tier].name}` : '예상 미지명'} · 동기 약 ${sr.rank}위</div></div></div>`;
  }

  // ── 드래프트
  function showDraft() {
    const d = S.pendingEnd.draft;
    if (!draftView) draftView = { shown: 0, timer: null, stage: 'intro' };
    const v = draftView;
    let h = '';
    if (v.stage === 'intro') {
      const st = d.stats;
      h = `${seasonSummary(S.pendingEnd)}
        <div class="sec">${secH('🎓 드래프트의 날', '동기 80명 중 고교 3년 성적으로 순위가 정해져요. 1~10순위 1부, 11~20순위 2부, 21~30순위 3부(1라운드), 31~40순위 3부(2라운드). 41위부터는 미지명이에요.')}
          ${tiles([{ v: st.apps, k: '고교 경기' }, { v: st.g, k: '골' }, { v: st.a, k: '도움' }, { v: st.avg.toFixed(2), k: '평점', cls: 'gold' }, { v: st.awards, k: '수상', cls: 'hl' }])}</div>
        <button class="btn go" data-act="draftGo" style="width:100%">🎓 드래프트 시작</button>`;
    } else {
      const total = d.picks.length;
      const myNo = d.myPick || total + 1;
      const shown = Math.min(v.shown, myNo, total);
      const cur = d.picks[Math.min(shown, total - 1)];
      const done = shown >= myNo || shown >= total;
      h = `<h2>🎓 드래프트</h2><p class="lead">동기 ${d.size}명 · 40명 지명</p>`;
      if (!done) h += `<div class="clock"><div class="faint small">${cur.round}라운드 ${cur.no}순위 지명 중</div><div class="row" style="justify-content:center;margin-top:4px">${crest(cur.teamId)} <b>${esc(teamName(cur.teamId))}</b> ${lgTag(TEAM_BY_ID[cur.teamId].tier)}</div></div>`;
      else if (d.myPick) {
        const c = d.contract;
        h += `<div class="card sel" style="text-align:center;padding:18px;margin-bottom:10px">
          <div class="num" style="font-size:20px;color:var(--accent)">${d.myPick <= 30 ? 1 : 2}라운드 ${d.myPick}순위</div>
          <div style="margin:8px 0">${crest(c.teamId, true)}</div><h2>${esc(teamName(c.teamId))}</h2><div>${lgTag(TEAM_BY_ID[c.teamId].tier)}</div>
          <div style="margin-top:12px">${tiles([{ v: fmtMoney(c.bonus), k: '계약금', cls: 'gold' }, { v: fmtMoney(c.salary), k: '연봉', cls: 'hl' }, { v: `${c.years}년`, k: '계약' }])}</div></div>
          <button class="btn go" data-act="resolve" data-arg="draft" style="width:100%">✍️ 계약하기</button>`;
      } else {
        h += `<div class="card" style="text-align:center;padding:18px;margin-bottom:10px"><div style="font-size:36px">😢</div><h2>지명받지 못했어요</h2>
          <div class="muted small">동기 ${d.size}명 중 ${d.rank}위 — 입단 테스트로 프로의 문을 두드려 보세요</div></div>
          <button class="btn go" data-act="resolve" data-arg="draft" style="width:100%">📭 무소속으로 시작</button>`;
      }
      h += `<div class="draftlist" style="margin-top:10px">${d.picks.slice(0, shown + (done && d.myPick ? 0 : 0)).slice().reverse().map((p) => `<div class="pk ${p.me ? 'me' : ''}"><span class="no">${p.no}</span>${crest(p.teamId)}<span>${esc(teamName(p.teamId))}</span><span class="faint">→</span><b>${esc(p.name)}</b><span class="faint">${POSITIONS[p.pos].icon} ${esc(p.school)}</span></div>`).join('')}</div>`;
      if (!done) h += `<button class="btn sm" data-act="draftSkip" style="margin-top:8px">결과 바로 보기 ⏭</button>`;
    }
    showModal('draft', h);
  }
  function draftTick() {
    const d = S.pendingEnd && S.pendingEnd.draft;
    if (!d || !draftView) { clearInterval(draftView && draftView.timer); return; }
    const myNo = d.myPick || d.picks.length;
    draftView.shown++;
    if (draftView.shown >= myNo) { clearInterval(draftView.timer); draftView.shown = myNo; if (d.myPick) banner(`🎉 ${d.myPick}순위 지명!`, teamName(d.contract.teamId)); }
    showDraft();
  }

  // ── 앱 설치 방법
  function showHowto() {
    showModal('howto', `<h2>🖥️ 데스크탑 앱 설치</h2><p class="lead">설치하면 바탕화면 맨 아래에 선수가 사는 띠가 붙어요. 빈 곳은 클릭이 뒤 창으로 그대로 넘어가요.</p>
      ${secH('🍎 Mac')}<div class="card small" style="margin-bottom:10px">1. 칩에 맞는 파일을 받아요 (M1·M2·M3… → Apple 칩, 그 전 Mac → Intel)<br>
        2. dmg를 열고 <b>SoccerStar</b>를 응용 프로그램 폴더로 끌어 놓아요<br>
        3. 처음 열 때 "확인되지 않은 개발자" 경고가 뜨면 <b>시스템 설정 → 개인정보 보호 및 보안</b> 맨 아래 <b>그래도 열기</b><br>
        4. 메뉴 막대의 ⚽ 아이콘으로 숨기기·캠프 열기·종료</div>
      ${secH('🪟 Windows')}<div class="card small" style="margin-bottom:10px">1. exe를 받아 실행해요<br>
        2. "Windows의 PC 보호" 창이 뜨면 <b>추가 정보 → 실행</b><br>
        3. 작업 표시줄 오른쪽 알림 영역의 ⚽ 아이콘으로 숨기기·캠프 열기·종료</div>
      <p class="small faint">앱은 게임 화면을 이 서버에서 불러와서, 게임이 업데이트되면 앱도 자동으로 최신이 돼요.</p>
      <button class="btn go" data-act="closeHowto">닫기</button>`);
  }
  let howtoBack = null;

  // ── 은퇴
  function showRetired() {
    const l = S.legends[S.legends.length - 1];
    showModal('retired', `<h2>🎖️ ${esc(S.name)} ${S.gen}세대 은퇴</h2><p class="lead">${posLabel(l.pos)}${l.title ? ` 「${esc(l.title)}」` : ''} · ${l.age}세</p>
      ${tiles([{ v: l.apps, k: '경기' }, { v: l.goals, k: '골', cls: 'hl' }, { v: l.assists, k: '도움' }, { v: l.trophies, k: '트로피', cls: 'gold' }, { v: l.awards, k: '개인상', cls: 'gold' }])}
      <p class="small muted">기록은 랭킹의 '가문의 전설'로 남아요. 다음 세대는 모든 능력치 +${Math.min(16, legacyBonus())}로 시작해요.</p>
      <button class="btn go" data-act="nextGen">👶 다음 세대 시작</button>`);
  }

  // ── 자리 비운 동안
  function snapshot() { return S ? { apps: S.career.apps, g: S.career.goals, a: S.career.assists, money: S.money, fame: S.fame, lv: S.lv } : null; }
  function showAway(a, b, banners) {
    showModal('away', `<h2>👋 자리를 비운 동안</h2><p class="lead">${b.apps - a.apps}경기를 뛰었어요</p>
      ${tiles([{ v: b.g - a.g, k: '골', cls: 'hl' }, { v: b.a - a.a, k: '도움' }, { v: fmtMoney(b.money - a.money), k: '수입', cls: 'gold' }, { v: '+' + fmtNum(b.fame - a.fame), k: '팔로워' }, { v: b.lv > a.lv ? `${a.lv}→${b.lv}` : b.lv, k: '레벨' }])}
      ${banners.length ? `<div class="card small muted" style="margin-top:10px">${banners.slice(-8).map(esc).join('<br>')}</div>` : ''}
      <p><button class="btn go" data-act="awayOk">확인</button></p>`);
  }

  // ── 발롱도르 보상
  async function checkBd() {
    try { bd = { data: await Net.ballondor(), at: Date.now() }; } catch { return; }
    if (bd.data.reward && !modal) showModal('bd', `<h2>🥇 발롱도르 시즌 ${bd.data.reward.period + 1}</h2>
      <div class="card sel" style="text-align:center;padding:20px"><div class="num" style="font-size:54px;color:var(--gold)">${bd.data.reward.rank}위</div><div class="muted">서버 전체 순위</div></div>
      <p><button class="btn go" data-act="claimBd">보상 받기</button></p>`);
  }
  async function claimBd() {
    const rw = bd.data && bd.data.reward;
    if (!rw) return;
    try { await Net.ackBd(rw.period); } catch (e) { toast(e.message); return; }
    const base = Math.max(1000, S.contract ? S.contract.salary : 500);
    const mul = rw.rank === 1 ? 1 : rw.rank === 2 ? 0.6 : rw.rank === 3 ? 0.4 : 0.15;
    const name = rw.rank === 1 ? '🏆 발롱도르' : rw.rank <= 3 ? `발롱도르 ${rw.rank}위` : '발롱도르 TOP 10';
    S.money += Math.round(base * mul);
    addFame(S.fame * mul * 0.3 + 10000 * mul);
    S.career.awards.push(`시즌 ${rw.period + 1} ${name}`);
    bd.data.reward = null;
    closeModal();
    banner(name, `상금 ${fmtMoney(base * mul)}`);
    saveLocal(); Net.sync(true);
    dirty = true;
  }

  // ───────────────────────── 클릭 ─────────────────────────
  async function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (el.tagName === 'A') e.preventDefault();
    const act = el.dataset.act, arg = el.dataset.arg;
    switch (act) {
      case 'openCamp': campOpen ? closeCamp() : openCamp(); break;
      case 'closeCamp': closeCamp(); break;
      case 'tab': setTab(arg); break;
      case 'startRun': if (startRun()) { toast('🚌 경기장으로 출발!'); if (desktop) closeCamp(); } break;
      case 'stopRun': stopRun(); break;
      case 'report': openReports.has(arg) ? openReports.delete(arg) : openReports.add(arg); break;
      case 'train': train(arg); break;
      case 'train10': for (let i = 0; i < 10 && train(arg); i++); break;
      case 'style': chooseStyle(arg); break;
      case 'title': takeTitle(); break;
      case 'learn': learnSkill(arg); break;
      case 'master': masterSkill(arg); break;
      case 'enhance': { const r = enhance(arg); if (r) toast({ ok: '✨ 강화 성공!', fail: '강화 실패 (단계 유지)', drop: '💥 강화 실패 — 1단계 하락' }[r]); break; }
      case 'equip': equip(Number(arg)); break;
      case 'autoEquip': autoEquip(); break;
      case 'sell': sellGear(Number(arg)); break;
      case 'sellBelow': { const r = sellBelow(Number(arg)); toast(`${r.n}개 판매 · +${fmtMoney(r.sum)}`); break; }
      case 'build': startBuild(arg); break;
      case 'date': { const d = doDate(arg); if (d) toast(`${d.icon} ${d.name} — 호감 +${d.aff}`); break; }
      case 'meet': meet(arg); break;
      case 'breakup': if (confirm('정말 헤어질까요?')) breakUp(); break;
      case 'rankSort': rank.sort = arg; rank.data = null; loadRank(); break;
      case 'reloadRank': loadRank(); break;
      case 'duel': await doDuel(arg); break;
      case 'claimBd': await claimBd(); break;
      // 무소속
      case 'tryout': { const ok = tryout(Number(arg)); if (ok != null) toast(ok ? '✅ 입단 테스트 합격!' : '❌ 불합격… 더 훈련해서 다시 도전해요'); break; }
      case 'signTry': signFree('try'); afterResolve(); break;
      case 'signFree': signFree(Number(arg)); afterResolve(); break;
      case 'declineTry': declineTryOffer(); break;
      case 'retireFree': if (confirm('정말 은퇴할까요? 다음 세대 선수로 새로 시작해요.')) { retire(); closeCamp(); showRetired(); saveLocal(); Net.sync(true); } break;
      // 시작 화면
      case 'startName': await startName(); break;
      case 'showFind': $('findbox').classList.toggle('hidden'); if (!$('findbox').classList.contains('hidden')) $('in-rname').focus(); break;
      case 'recover': await recoverAcc(); break;
      case 'myCode': showMyCode(); break;
      case 'closeModal': closeModal(); break;
      case 'cPos': createState.pos = arg; createState.special = Object.entries(POSITIONS[arg].w).sort((a, b) => b[1] - a[1])[0][0]; showCreate(); break;
      case 'cFoot': createState.foot = arg; showCreate(); break;
      case 'cSpecial': createState.special = arg; showCreate(); break;
      case 'cDone': await createDone(); break;
      // 결산 · 드래프트
      case 'seasonEnd': showSeasonEnd(); break;
      case 'draftGo': draftView.stage = 'live'; draftView.timer = setInterval(draftTick, 420); showDraft(); break;
      case 'draftSkip': clearInterval(draftView.timer); draftView.shown = S.pendingEnd.draft.myPick || S.pendingEnd.draft.picks.length; showDraft(); break;
      case 'nego': {
        const [i, pct] = arg.split(':');
        const ok = negotiate(Number(i), Number(pct));
        toast(ok ? '🤝 구단이 요구를 받아들였어요!' : '🙅 구단이 거절했어요 — 원래 조건만 남았어요');
        if (S.pendingEnd) showSeasonEnd();
        break;
      }
      case 'accept': resolveSeason({ type: 'offer', i: Number(arg) }); closeModal(); afterResolve(); break;
      case 'resolve': resolveSeason({ type: arg }); draftView = null; closeModal(); afterResolve(); break;
      case 'retire': if (confirm('정말 은퇴할까요? 다음 세대 선수로 새로 시작해요.')) { resolveSeason({ type: 'retire' }); closeCamp(); showRetired(); saveLocal(); Net.sync(true); } break;
      case 'nextGen': createState = { name: S.name, pos: 'FW', foot: 'R', special: 'sho', nextGen: true }; showCreate(); break;
      case 'awayOk': closeModal(); if (S.pendingEnd) showSeasonEnd(); break;
      case 'howto': howtoBack = modal ? { kind: modal, html: $('modal').innerHTML } : null; showHowto(); break;
      case 'closeHowto': if (howtoBack) showModal(howtoBack.kind, howtoBack.html); else closeModal(); howtoBack = null; break;
    }
    dirty = true;
    renderHud();
    renderCamp();
  }
  function afterResolve() {
    saveLocal();
    Net.sync(true);
    if (S.season) toast(`📅 ${S.season.no}시즌 ${LEAGUES[S.season.tier].name} 시작 — ${teamName(S.teamId)}`);
  }
  async function doDuel(name) {
    try {
      saveLocal();
      await Net.sync(true);
      const { duel } = await Net.duel(name);
      Bar.playDuel(duel, true);
      if (desktop) closeCamp();
      const win = duel.winner === 0;
      setTimeout(() => toast(`🥅 승부차기 ${duel.score[0]}:${duel.score[1]} ${win ? '승리' : '패배'} (${duel.delta > 0 ? '+' : ''}${duel.delta}점)`), (duel.kicks.length + 1) * 1600);
      setTimeout(loadRank, (duel.kicks.length + 2) * 1600);
    } catch (e) { toast(e.message); }
  }

  // ───────────────────────── 시작 ─────────────────────────
  let started = false;
  function enterGame(fresh = false) {
    if (!fresh) {
      quiet = true; quietBanners = [];
      const a = snapshot();
      tick();
      const b = snapshot();
      quiet = false;
      if (b.apps > a.apps) showAway(a, b, quietBanners);
      else if (S.pendingEnd) showSeasonEnd();
    } else tick();
    if (S.phase === 'retired' && !modal) showRetired();
    saveLocal();
    Net.refreshWorld(true);
    Net.sync(true);
    checkBd();
    if (started) return;
    started = true;
    setInterval(loop, 250);
    setInterval(saveLocal, 10000);
    setInterval(checkBd, 600000);
    setInterval(checkUpdate, 300000);
    addEventListener('beforeunload', () => { saveLocal(); Net.sync(); });
  }
  // 서버에 새 버전이 올라왔으면 저장하고 다시 불러온다 (앱은 웹 버전으로, 웹은 새로고침)
  async function checkUpdate() {
    try {
      const txt = await (await fetch(`${Net.SERVER}/src/data.js`, { cache: 'no-store' })).text();
      const m = /GAME_VERSION = '([^']+)'/.exec(txt);
      if (!m || m[1] === GAME_VERSION) return;
      saveLocal();
      await Net.sync(true);
      if (desktop) window.soccerDesktop.reloadWeb(); else location.reload();
    } catch {}
  }
  function loop() {
    if (!S) return;
    tick();
    if (pressing) return;
    renderHud();
    if (S.pendingEnd && !modal && S.mode === 'home') showSeasonEnd();
    if (campOpen && (dirty || Date.now() - renderedAt > 1000)) renderCamp();
  }
  async function boot() {
    hooks.toast = toast;
    hooks.banner = banner;
    hooks.changed = () => { dirty = true; };
    Net.onStatus(() => { dirty = true; });
    Bar.init($('cv'));
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.target.id === 'in-name') startName();
      if (e.key === 'Enter' && !e.isComposing && (e.target.id === 'in-rcode' || e.target.id === 'in-rname')) recoverAcc();
      if (e.key === 'Escape' && campOpen) closeCamp();
    });
    renderHud();
    const name = Net.activeName();
    if (!name) { showStart(); return; }
    let save = loadLocal(name);
    if (!save) showModal('loading', '<h2>⚽ 불러오는 중…</h2><p class="lead">서버가 잠들어 있으면 1분쯤 걸려요.</p>');
    try {
      const r = await Net.loadRemote();
      if (r.save && (!save || (r.save.lastSeen || 0) > (save.lastSeen || 0))) save = migrate(r.save);
    } catch (e) {
      if (e.code === 'gone' && !(save && await Net.reRegister(name))) { Net.forget(name); showStart('서버에서 계정을 찾을 수 없어요. 새로 만들어 주세요.'); return; }
      if (!save) { showModal('loading', `<h2>서버에 연결할 수 없어요</h2><p class="err">${esc(e.message)}</p><button class="btn go" onclick="location.reload()">다시 시도</button>`); return; }
    }
    if (modal === 'loading') closeModal();
    if (!save) { createState = { name, pos: 'FW', foot: 'R', special: 'sho', nextGen: false, accountMade: true }; showCreate(); return; }
    S = save;
    enterGame();
  }
  boot();

  return { openCamp, closeCamp };
})();
