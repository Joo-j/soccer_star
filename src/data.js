'use strict';
// 게임 데이터: 리그·팀·포지션·스타일·스킬·장비·시설·연애 상대. 계산은 core.js, 경기는 match.js 가 한다.

const GAME_VERSION = '0.3.2';
const SAVE_V = 1;

// 실시간 길이 (초). 경기 한 판 = 90분을 MATCH_SEC 초에 재생, 경기 사이 이동 TRAVEL_SEC 초
const MATCH_SEC = 90;
const TRAVEL_SEC = 8;
const STAMINA_PER_MATCH = 22;
const REST_FULL_SEC = 900; // 집 Lv0 기준 스태미나 0→최대 회복 시간

// ───────────────────────── 능력치 ─────────────────────────
const STATS = [
  { id: 'sho', name: '슈팅', icon: '🎯' },
  { id: 'pas', name: '패스', icon: '🦶' },
  { id: 'dri', name: '드리블', icon: '💨' },
  { id: 'def', name: '수비', icon: '🛡️' },
  { id: 'phy', name: '피지컬', icon: '💪' },
];
const STAT_NAME = Object.fromEntries(STATS.map((s) => [s.id, s.name]));
const STAT_MAX = 99;

// ───────────────────────── 포지션 · 스타일 · 칭호 ─────────────────────────
const POSITIONS = {
  FW: { name: '공격수', icon: '⚡', color: '#ff6b5b', w: { sho: .45, dri: .25, phy: .15, pas: .1, def: .05 },
        start: { sho: 34, pas: 26, dri: 30, def: 18, phy: 28 }, desc: '골로 말한다. 슈팅·드리블 스킬을 주로 쓴다' },
  MF: { name: '미드필더', icon: '🎼', color: '#ffc94a', w: { pas: .4, dri: .2, sho: .15, def: .1, phy: .15 },
        start: { sho: 26, pas: 34, dri: 30, def: 24, phy: 26 }, desc: '경기를 지휘한다. 도움과 중거리 슛' },
  DF: { name: '수비수', icon: '🧱', color: '#5bb0ff', w: { def: .5, phy: .25, pas: .15, dri: .05, sho: .05 },
        start: { sho: 18, pas: 26, dri: 22, def: 34, phy: 32 }, desc: '태클과 가로채기. 세트피스 헤딩골' },
  GK: { name: '골키퍼', icon: '🧤', color: '#7be07b', w: { def: .55, phy: .25, pas: .15, dri: 0, sho: .05 },
        start: { sho: 14, pas: 26, dri: 16, def: 36, phy: 32 }, desc: '선방이 곧 실력. GK는 수비 = 선방 능력' },
};

// Lv15 스타일, Lv50 칭호. mul: 능력치 배율 보너스, train: 훈련비 할인 능력치
const STYLES = {
  FW: [
    { id: 'poacher', name: '골잡이', mul: { sho: .12 }, train: ['sho'], perk: '슛 결정력 +8%', title: '득점 기계', tmul: { sho: .12, phy: .05 } },
    { id: 'speedster', name: '스피드스타', mul: { dri: .12, phy: .05 }, train: ['dri'], perk: '드리블 스킬 발동 +30%', title: '번개 윙어', tmul: { dri: .12, sho: .06 } },
    { id: 'target', name: '타깃맨', mul: { phy: .12, sho: .05 }, train: ['phy'], perk: '헤딩골 2배', title: '공중의 지배자', tmul: { phy: .1, sho: .08 } },
  ],
  MF: [
    { id: 'maestro', name: '플레이메이커', mul: { pas: .12 }, train: ['pas'], perk: '도움 확률 +25%', title: '그라운드의 지휘자', tmul: { pas: .12, dri: .06 } },
    { id: 'b2b', name: '박스투박스', mul: { phy: .08, def: .06 }, train: ['phy'], perk: '스태미나 소모 -20%', title: '엔진', tmul: { phy: .1, sho: .06, def: .04 } },
    { id: 'technician', name: '테크니션', mul: { dri: .12 }, train: ['dri'], perk: '드리블 성공 시 슛·패스 +10%', title: '마법사', tmul: { dri: .12, pas: .06 } },
  ],
  DF: [
    { id: 'stopper', name: '스토퍼', mul: { def: .12 }, train: ['def'], perk: '태클 성공 +10%', title: '통곡의 벽', tmul: { def: .12, phy: .06 } },
    { id: 'builder', name: '빌드업 수비수', mul: { pas: .12, def: .04 }, train: ['pas'], perk: '롱패스 도움 +30%', title: '후방 사령관', tmul: { pas: .1, def: .08 } },
    { id: 'wingback', name: '공격형 풀백', mul: { dri: .1, phy: .05 }, train: ['dri'], perk: '공격 가담 2배', title: '측면의 폭주기관차', tmul: { dri: .1, pas: .08 } },
  ],
  GK: [
    { id: 'reflex', name: '선방형', mul: { def: .12 }, train: ['def'], perk: '선방 +5%', title: '거미손', tmul: { def: .12, phy: .05 } },
    { id: 'sweeper', name: '스위퍼 키퍼', mul: { pas: .12, def: .04 }, train: ['pas'], perk: '골킥 도움 가능', title: '11번째 필드 플레이어', tmul: { pas: .1, def: .08 } },
    { id: 'wall', name: '철벽', mul: { phy: .1, def: .05 }, train: ['phy'], perk: '1:1 선방 +10%', title: '수호신', tmul: { def: .08, phy: .1 } },
  ],
};
const STYLE_LV = 15;
const TITLE_LV = 50;

// ───────────────────────── 스킬 ─────────────────────────
// kind: shot(내 슛 결정력) / drib(슛·패스 전 돌파) / pass(도움 확률) / def(태클) / gk(선방)
// pos: 배울 수 있는 포지션, lv: 배울 수 있는 레벨, pow: 기본 효과(Lv1), fx: 하단바 연출
const SKILLS = [
  { id: 'banana', name: '바나나킥', kind: 'shot', pos: ['FW', 'MF'], lv: 1, pow: .07, fx: 'curve', desc: '공을 크게 휘어 골문 구석에 꽂는다' },
  { id: 'power', name: '파워 슛', kind: 'shot', pos: ['FW', 'MF', 'DF'], lv: 3, pow: .06, fx: 'power', desc: '골키퍼 손이 밀릴 만큼 강하게' },
  { id: 'chip', name: '칩슛', kind: 'shot', pos: ['FW'], lv: 8, pow: .08, fx: 'chip', desc: '나온 골키퍼 머리 위로 살짝' },
  { id: 'knuckle', name: '무회전킥', kind: 'shot', pos: ['FW', 'MF'], lv: 18, pow: .1, fx: 'knuckle', desc: '흔들리며 떨어지는 마구' },
  { id: 'header', name: '다이빙 헤더', kind: 'shot', pos: ['FW', 'DF'], lv: 10, pow: .08, fx: 'header', desc: '몸을 날려 머리로 받아 넣는다' },
  { id: 'bicycle', name: '바이시클킥', kind: 'shot', pos: ['FW'], lv: 35, pow: .14, fx: 'bicycle', desc: '공중에서 거꾸로 차는 오버헤드킥' },
  { id: 'stepover', name: '헛다리 짚기', kind: 'drib', pos: ['FW', 'MF', 'DF'], lv: 2, pow: .05, fx: 'step', desc: '발을 휘저어 수비를 속인다' },
  { id: 'marseille', name: '마르세유 턴', kind: 'drib', pos: ['FW', 'MF'], lv: 12, pow: .08, fx: 'spin', desc: '공을 끌며 한 바퀴 돌아 빠져나간다' },
  { id: 'elastico', name: '엘라스티코', kind: 'drib', pos: ['FW', 'MF'], lv: 25, pow: .11, fx: 'step', desc: '바깥발로 밀었다 안쪽으로 순식간에 접는다' },
  { id: 'through', name: '스루패스', kind: 'pass', pos: ['MF', 'FW'], lv: 1, pow: .07, fx: 'through', desc: '수비 사이로 찔러 주는 결정적 패스' },
  { id: 'nolook', name: '노룩 패스', kind: 'pass', pos: ['MF'], lv: 14, pow: .1, fx: 'through', desc: '보지도 않고 동료 발 앞에' },
  { id: 'longball', name: '대지 패스', kind: 'pass', pos: ['MF', 'DF', 'GK'], lv: 5, pow: .07, fx: 'long', desc: '하프라인 뒤에서 한 번에 넘기는 롱패스' },
  { id: 'slide', name: '슬라이딩 태클', kind: 'def', pos: ['DF', 'MF'], lv: 1, pow: .08, fx: 'slide', desc: '미끄러지며 공만 정확히 걷어낸다' },
  { id: 'intercept', name: '인터셉트', kind: 'def', pos: ['DF', 'MF'], lv: 8, pow: .07, fx: 'cut', desc: '패스 길목을 읽고 먼저 끊는다' },
  { id: 'aerial', name: '공중볼 장악', kind: 'def', pos: ['DF'], lv: 20, pow: .1, fx: 'cut', desc: '높은 공은 전부 내 것' },
  { id: 'dive', name: '다이빙 세이브', kind: 'gk', pos: ['GK'], lv: 1, pow: .06, fx: 'dive', desc: '골문 구석까지 몸을 날린다' },
  { id: 'punch', name: '펀칭', kind: 'gk', pos: ['GK'], lv: 6, pow: .05, fx: 'dive', desc: '혼전 속 공을 주먹으로 쳐낸다' },
  { id: 'oneonone', name: '1:1 방어', kind: 'gk', pos: ['GK'], lv: 16, pow: .08, fx: 'dive', desc: '각을 좁혀 공격수를 막아선다' },
  { id: 'pksave', name: 'PK 선방', kind: 'gk', pos: ['GK'], lv: 28, pow: .1, fx: 'dive', desc: '방향을 읽는다. 승부차기에서도 쓰인다' },
];
const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
const SKILL_MAX = 10;
// 스킬 숙련 Lv n → n+1 에 드는 연습 노트
const skillNoteCost = (lv) => Math.round(2 * Math.pow(1.45, lv - 1));

// ───────────────────────── 리그 · 팀 ─────────────────────────
// tier 0 고교, 1 3부, 2 2부, 3 1부, 4 월드리그
const LEAGUES = [
  { tier: 0, name: '고교 리그', short: '고교', icon: '🏫', rounds: 1, salary: 0, pocket: 15, ovrReq: 0, weight: .3, color: '#9bd36a' },
  { tier: 1, name: '3부 리그', short: '3부', icon: '🥉', rounds: 2, salary: 2400, ovrReq: 0, weight: .55, color: '#c98a54' },
  { tier: 2, name: '2부 리그', short: '2부', icon: '🥈', rounds: 2, salary: 7000, ovrReq: 56, weight: .75, color: '#c0c8d4' },
  { tier: 3, name: '1부 리그', short: '1부', icon: '🥇', rounds: 2, salary: 24000, ovrReq: 65, weight: 1, color: '#ffd24a' },
  { tier: 4, name: '월드 리그', short: '월드', icon: '🌍', rounds: 2, salary: 150000, ovrReq: 75, weight: 1.4, color: '#b38bff' },
];

// [이름, 기준 능력, 주색, 보조색]
const TEAMS_RAW = [
  [['한빛고', 46, '#e04848', '#fff'], ['동산공고', 41, '#3d6fd8', '#fff'], ['청운고', 49, '#2aa96b', '#fff'], ['서해고', 43, '#f0a020', '#222'],
   ['백두고', 51, '#ffffff', '#c22'], ['푸른솔고', 44, '#1a9c9c', '#fff'], ['남강고', 40, '#8a4fd0', '#fff'], ['태양고', 47, '#ff7a2a', '#222'],
   ['은하고', 42, '#222a44', '#ffd24a'], ['새벽고', 38, '#d9d9d9', '#335']],
  [['바다시티 FC', 55, '#2f7fd8', '#fff'], ['산골 유나이티드', 51, '#6b8e23', '#fff'], ['강변 레인저스', 58, '#d04040', '#fff'], ['들녘 FC', 49, '#d8b440', '#222'],
   ['항구 도크스', 56, '#334a66', '#fff'], ['철길 FC', 53, '#777', '#fff'], ['숲속 울브스', 57, '#2d6b3a', '#fff'], ['언덕 FC', 50, '#a0522d', '#fff'],
   ['호수 FC', 54, '#5ec4e8', '#123'], ['광산 마이너스', 52, '#3a3a3a', '#f0c040']],
  [['블루포트', 63, '#2a5cd8', '#fff'], ['레드힐 FC', 64, '#c82828', '#fff'], ['실버타운', 61, '#b8c0c8', '#223'], ['그린밸리', 60, '#2aa050', '#fff'],
   ['아이언시티', 66, '#555c66', '#fff'], ['골든베이', 65, '#e8b830', '#222'], ['스톰 FC', 62, '#4a3ab0', '#fff'], ['썬더 유나이티드', 67, '#f0e040', '#222'],
   ['노스게이트', 59, '#e0e8f0', '#235'], ['이스트우드', 58, '#7a4a2a', '#fff']],
  [['수도 드래곤즈', 74, '#d02030', '#ffd24a'], ['남부 타이거즈', 72, '#ff8a00', '#222'], ['동해 마린즈', 70, '#1a5ab0', '#fff'], ['중부 이글스', 69, '#ffffff', '#222'],
   ['서부 피닉스', 73, '#c0302a', '#222'], ['북부 울브스', 68, '#555', '#fff'], ['항도 샤크스', 71, '#2a8ac0', '#fff'], ['고원 베어스', 67, '#6a3a1a', '#fff'],
   ['평야 호크스', 66, '#3a8a3a', '#fff'], ['해안 돌핀스', 70, '#40c0d0', '#123']],
  [['로얄 크라운', 86, '#ffffff', '#c9a020'], ['아틀라스 CF', 84, '#a01030', '#1a2a80'], ['발할라 SV', 85, '#d01010', '#fff'], ['올림푸스 FC', 82, '#5ab0ff', '#fff'],
   ['티탄 유나이티드', 83, '#c81818', '#111'], ['아르테미스 AC', 80, '#111', '#d02020'], ['아틀란티스 FC', 78, '#1a3a8a', '#fff'], ['메리디안 CF', 79, '#ffd030', '#1a2a80'],
   ['오로라 SC', 77, '#3ad0a0', '#fff'], ['솔라리스 FC', 81, '#ff9020', '#222']],
];
const TEAMS = [];
TEAMS_RAW.forEach((list, tier) => list.forEach(([name, r, c1, c2], i) => TEAMS.push({ id: `t${tier}_${i}`, tier, name, r, c1, c2 })));
const TEAM_BY_ID = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
const teamsOfTier = (tier) => TEAMS.filter((t) => t.tier === tier);

// 팀마다 리그 기록 경쟁자가 될 AI 스타 둘 (공격수·미드필더). 이름은 팀 id 로 고정 생성
const KR_FAMILY = '김이박최정강조윤장임한오서신권황안송류홍전고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용';
const KR_GIVEN = ['민준', '서준', '도윤', '예준', '시우', '하준', '지호', '주원', '지후', '준우', '건우', '현우', '선우', '우진', '민재', '현준', '연우', '유준', '정우', '승우', '승현', '시윤', '준혁', '은우', '지환', '승민', '지우', '유찬', '윤우', '민성', '준영', '시후', '진우', '지원', '수호', '재윤', '태윤', '한결', '이안', '태민'];
const WORLD_FIRST = ['루카', '마테오', '라파', '엔조', '다비드', '카를로스', '티아고', '레오', '마르코', '파블로', '알렉스', '하비', '니코', '안드레', '세바', '토마스', '이반', '루이스', '디에고', '에밀'];
const WORLD_LAST = ['로시', '페레스', '실바', '무어', '코스타', '베르크', '산토스', '뮐러', '모렐', '가르시아', '노바크', '페트로프', '마르텔', '디아스', '루소', '반데르', '요한센', '오코예', '카스트로', '피레스'];
function seededRand(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function aiStarsOf(teamId) {
  const team = TEAM_BY_ID[teamId];
  const rnd = seededRand('star' + teamId);
  const name = () => team.tier === 4
    ? `${WORLD_FIRST[Math.floor(rnd() * WORLD_FIRST.length)]} ${WORLD_LAST[Math.floor(rnd() * WORLD_LAST.length)]}`
    : KR_FAMILY[Math.floor(rnd() * KR_FAMILY.length)] + KR_GIVEN[Math.floor(rnd() * KR_GIVEN.length)];
  return [
    { key: teamId + ':fw', teamId, name: name(), pos: 'FW', age: 19 + Math.floor(rnd() * 14) },
    { key: teamId + ':mf', teamId, name: name(), pos: 'MF', age: 19 + Math.floor(rnd() * 14) },
  ];
}

// ───────────────────────── 장비 ─────────────────────────
const GRADES = [
  { id: 0, name: '일반', color: '#c8c8c8', bonus: 1 },
  { id: 1, name: '고급', color: '#6fdc6f', bonus: 2 },
  { id: 2, name: '희귀', color: '#5ab0ff', bonus: 4 },
  { id: 3, name: '영웅', color: '#c27bff', bonus: 6 },
  { id: 4, name: '전설', color: '#ffb02e', bonus: 9 },
  { id: 5, name: '시그니처', color: '#ff5a7a', bonus: 12 },
];
// 부위별 오르는 능력치 (주/보조)
const SLOTS = {
  boots: { name: '축구화', icon: '👟', main: 'sho', sub: 'dri' },
  guard: { name: '정강이 보호대', icon: '🦵', main: 'def', sub: 'phy' },
  acc: { name: '액세서리', icon: '📿', main: 'pas', sub: 'sho' },
};
const GEAR_NAMES = {
  boots: ['동네 축구화', '가죽 스터드', '경량 스피드화', '카본 프레데터', '골든 스트라이크', '시그니처 부츠'],
  guard: ['플라스틱 보호대', '스펀지 보호대', '카본 쉴드', '티타늄 가드', '드래곤 스케일', '시그니처 가드'],
  acc: ['고무 헤어밴드', '행운의 팔찌', '캡틴 완장', '챔피언 목걸이', '전설의 등번호', '시그니처 엠블럼'],
};
const ENH_MAX = 15;
// 강화 +n → +n+1: [성공률, 실패 시 하락 여부]
const enhanceInfo = (lv) => ({
  rate: lv < 3 ? 1 : lv < 6 ? .8 : lv < 9 ? .6 : lv < 12 ? .4 : .25,
  drop: lv >= 6,
  cost: Math.round(30 * Math.pow(1.55, lv)), // 만원
});

// ───────────────────────── 시설 ─────────────────────────
const BUILDINGS = [
  { id: 'gym', name: '개인 훈련장', icon: '🏋️', max: 9, desc: (lv) => `훈련 상한 ${trainCap(lv)}` },
  { id: 'home', name: '집', icon: '🏠', max: 10, desc: (lv) => `최대 스태미나 ${staminaMax(lv)} · 휴식 ${Math.round(restSec(lv))}초` },
  { id: 'clinic', name: '재활센터', icon: '🏥', max: 8, desc: (lv) => `부상 확률 -${lv * 8}% · 회복 시간 -${lv * 8}%` },
  { id: 'agency', name: '에이전시', icon: '💼', max: 8, desc: (lv) => `연봉 협상 +${lv * 5}% · 스폰서 수입 +${lv * 10}%` },
];
const trainCap = (lv) => Math.min(STAT_MAX, 45 + lv * 6);
const staminaMax = (lv) => 100 + lv * 25;
const restSec = (lv) => REST_FULL_SEC * (1 - lv * 0.05);
const buildCost = (lv) => Math.round(80 * Math.pow(2.7, lv)); // Lv lv → lv+1, 만원
const buildSec = (lv) => 30 + lv * lv * 40;

// ───────────────────────── 인기 · 스폰서 ─────────────────────────
const FAME_TIERS = [
  { min: 0, name: '무명', icon: '🌱' },
  { min: 3000, name: '유망주', icon: '🌿' },
  { min: 50000, name: '주목받는 선수', icon: '⭐' },
  { min: 500000, name: '스타', icon: '🌟' },
  { min: 3000000, name: '슈퍼스타', icon: '💫' },
  { min: 20000000, name: '레전드', icon: '👑' },
];
const SPONSORS = [
  { id: 's1', fame: 10000, name: '동네 스포츠용품점', pay: 5, box: 1 },
  { id: 's2', fame: 100000, name: '스포츠 음료 광고', pay: 40, box: 2 },
  { id: 's3', fame: 800000, name: '글로벌 축구화 브랜드', pay: 300, box: 3 },
  { id: 's4', fame: 5000000, name: '자동차 광고 모델', pay: 1500, box: 4 },
  { id: 's5', fame: 30000000, name: '시그니처 라인 출시', pay: 6000, box: 5 },
];

// ───────────────────────── 연애 ─────────────────────────
const PARTNERS = [
  { id: 'jisu', name: '지수', job: '카페 바리스타', fame: 0, emoji: '☕', like: '소소한 산책' },
  { id: 'haeun', name: '하은', job: '스포츠 아나운서', fame: 50000, emoji: '🎤', like: '경기 끝난 뒤 인터뷰' },
  { id: 'minji', name: '민지', job: '재활 트레이너', fame: 20000, emoji: '🩺', like: '건강한 식단' },
  { id: 'seoyeon', name: '서연', job: '배우', fame: 800000, emoji: '🎬', like: '조용한 레스토랑' },
  { id: 'yuna', name: '유나', job: '패션 모델', fame: 3000000, emoji: '👗', like: '해외 여행' },
];
const LOVE_STAGES = [
  { min: 0, name: '아는 사이' },
  { min: 20, name: '썸' },
  { min: 50, name: '연애 중' },
  { min: 85, name: '약혼' },
  { min: 100, name: '결혼' },
];
const DATES = [
  { id: 'msg', name: '메시지 보내기', icon: '💬', cost: 0, aff: 2, cd: 60 },
  { id: 'cafe', name: '카페 데이트', icon: '☕', cost: 5, aff: 5, cd: 180 },
  { id: 'dinner', name: '저녁 식사', icon: '🍝', cost: 30, aff: 9, cd: 300 },
  { id: 'gift', name: '선물', icon: '🎁', cost: 200, aff: 14, cd: 600 },
  { id: 'trip', name: '여행', icon: '✈️', cost: 1500, aff: 25, cd: 1800 },
];

// ───────────────────────── 부상 ─────────────────────────
const INJURIES = [
  { name: '발목 염좌', sec: 120, w: 5 },
  { name: '햄스트링 부상', sec: 360, w: 3 },
  { name: '무릎 인대 손상', sec: 1200, w: 1 },
];

// 발롱도르 시즌(서버): 3일, 한국 시간 2026-10-01 00:00 시작
const BD_EPOCH = Date.UTC(2026, 8, 30, 15, 0, 0);
const BD_PERIOD_MS = 3 * 24 * 3600 * 1000;
