'use strict';
// 데스크탑 하단바 앱: 화면 맨 아래에 붙는 투명 창. 평소엔 띠 높이(150px)만, 캠프·알림 창이 열리면 위로 늘어난다.
// 빈 곳은 클릭이 아래 창으로 통과한다 (렌더러가 마우스 위치를 보고 setIgnore 를 부른다).
// 게임 화면은 웹 버전(Render 서버)에서 불러온다 — 푸시만 하면 설치된 앱도 최신이 된다.
// 웹을 못 불러오면(오프라인·서버가 너무 늦게 깨어남) 앱에 들어 있는 파일로 연다.
//   npm run app              → https://soccer-star.onrender.com
//   npm run app:local        → 로컬 서버(3140)

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const BAR_H = 150;
const BIG_H = 780;
const WEB_URL = (process.env.SOCCER_WEB || 'https://soccer-star.onrender.com').replace(/\/+$/, '') + '/';
const WEB_TIMEOUT = 25000; // Render 무료 서버가 깨어나는 동안 기다리는 최대 시간
let win = null;
let tray = null;
let expanded = false;

app.setPath('userData', path.join(app.getPath('appData'), 'soccer-star'));

// ── 저장소: 웹·내장 파일 어느 쪽으로 열려도 같은 계정·세이브를 보도록 앱 폴더의 파일 하나에 둔다
const STORE_FILE = path.join(app.getPath('userData'), 'store.json');
let store = {};
try { store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch {}
function writeStore() {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, STORE_FILE);
}
ipcMain.on('store:get', (e, key) => { e.returnValue = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; });
ipcMain.on('store:set', (e, key, value) => {
  store[key] = value;
  try { writeStore(); } catch {}
  e.returnValue = true;
});

function bounds(big) {
  const wa = screen.getPrimaryDisplay().workArea;
  const h = big ? Math.min(BIG_H, wa.height) : BAR_H;
  return { x: wa.x, y: wa.y + wa.height - h, width: wa.width, height: h };
}

function loadGame() {
  let done = false;
  const local = () => {
    if (done) return;
    done = true;
    win.loadFile(path.join(__dirname, '..', 'index.html'), { query: { server: WEB_URL.replace(/\/$/, '') } });
  };
  const timer = setTimeout(local, WEB_TIMEOUT);
  win.loadURL(WEB_URL)
    .then(() => { done = true; clearTimeout(timer); })
    .catch(() => { clearTimeout(timer); local(); });
}

function create() {
  win = new BrowserWindow({
    ...bounds(false),
    transparent: true, frame: false, resizable: false, movable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setIgnoreMouseEvents(true, { forward: true });
  // 링크(앱 받기·GitHub 등)는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  loadGame();
  screen.on('display-metrics-changed', () => win && win.setBounds(bounds(expanded)));
}

ipcMain.on('bar:ignore', (_e, ignore) => { if (win) win.setIgnoreMouseEvents(!!ignore, { forward: true }); });
ipcMain.on('bar:expand', (_e, big) => {
  if (!win || expanded === !!big) return;
  expanded = !!big;
  win.setBounds(bounds(expanded));
  if (expanded) win.focus();
});
ipcMain.on('bar:notify', (_e, { title, body }) => {
  const { Notification } = require('electron');
  if (Notification.isSupported()) new Notification({ title, body }).show();
});
// 새 버전이 올라왔을 때 (렌더러가 저장을 마친 뒤 부른다)
ipcMain.on('bar:reload-web', () => { if (win) loadGame(); });

function makeTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('축구선수 키우기');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '보이기 / 숨기기', click: () => (win.isVisible() ? win.hide() : win.show()) },
    { label: '캠프 열기', click: () => { win.show(); win.webContents.executeJavaScript('UI.openCamp()'); } },
    { label: '새로고침', click: () => loadGame() },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  create();
  makeTray();
});
app.on('window-all-closed', () => app.quit());
