'use strict';
// 앱 껍데기 자동 업데이트. GitHub 최신 릴리스가 지금 앱보다 새 버전이면 받아서 바꿔 끼우고 다시 켠다.
// Mac: SoccerStar-mac-<arch>.zip 을 풀어 지금 .app 자리에 덮어쓴다 (정식 서명이 없어 Electron 기본 업데이트는 못 쓴다).
// Windows: SoccerStar-win-x64.exe(NSIS)를 조용히 실행해 덮어 설치하고 다시 켠다.
// 개발 실행(npm run app)에서는 하지 않는다. SOCCER_UPDATE_FEED 로 다른 릴리스 주소를 줄 수 있다(시험용).

const { app, Notification } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const FEED = process.env.SOCCER_UPDATE_FEED || 'https://api.github.com/repos/Joo-j/soccer_star/releases/latest';
const CHECK_EVERY = 3 * 3600 * 1000;
let busy = false;

function newer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
function assetName() {
  if (process.platform === 'darwin') return `SoccerStar-mac-${process.arch}.zip`;
  if (process.platform === 'win32') return 'SoccerStar-win-x64.exe';
  return null;
}
async function download(url, file) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SoccerStar' } });
  if (!res.ok) throw new Error(`받기 실패 ${res.status}`);
  const tmp = file + '.part';
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, file);
}

function applyMac(zip) {
  const appPath = path.resolve(process.execPath, '..', '..', '..');
  if (!appPath.endsWith('.app')) throw new Error(`앱 위치를 알 수 없어요: ${appPath}`);
  fs.accessSync(path.dirname(appPath), fs.constants.W_OK);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soccerstar-new-'));
  execFileSync('ditto', ['-x', '-k', zip, dir]);
  const fresh = path.join(dir, 'SoccerStar.app');
  if (!fs.existsSync(fresh)) throw new Error('받은 파일에 앱이 없어요');
  // 이 앱이 완전히 꺼지면 바꿔 끼우고 다시 켠다 (실행 파일을 직접 띄워 환경 변수를 그대로 넘긴다)
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const script = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done; rm -rf ${q(appPath)} && mv ${q(fresh)} ${q(appPath)} && xattr -dr com.apple.quarantine ${q(appPath)} 2>/dev/null; ${q(path.join(appPath, 'Contents', 'MacOS', 'SoccerStar'))} >/dev/null 2>&1 &`;
  spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
}
function applyWin(exe) {
  spawn(exe, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
}

async function check() {
  if (busy || (!app.isPackaged && !process.env.SOCCER_UPDATE_FEED)) return;
  busy = true;
  try {
    const rel = await (await fetch(FEED, { headers: { 'User-Agent': 'SoccerStar', Accept: 'application/vnd.github+json' } })).json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    const name = assetName();
    const asset = (rel.assets || []).find((a) => a.name === name);
    if (!latest || !newer(latest, app.getVersion()) || !asset) return;
    const file = path.join(os.tmpdir(), `soccerstar-${latest}-${name}`);
    if (!fs.existsSync(file)) await download(asset.browser_download_url, file);
    if (Notification.isSupported()) new Notification({ title: '축구선수 키우기', body: `새 버전 ${latest}으로 업데이트하고 다시 켤게요` }).show();
    if (process.platform === 'darwin') applyMac(file); else applyWin(file);
    setTimeout(() => app.quit(), 1500);
  } catch (e) {
    console.warn('업데이트 확인 실패:', e.message);
  } finally {
    busy = false;
  }
}

function start() {
  setTimeout(check, 15000);
  setInterval(check, CHECK_EVERY);
}

module.exports = { start, check };
