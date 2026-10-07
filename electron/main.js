'use strict';
// 데스크탑 하단바 앱: 화면 맨 아래에 붙는 투명 창. 평소엔 띠 높이(150px)만, 캠프·알림 창이 열리면 위로 늘어난다.
// 빈 곳은 클릭이 아래 창으로 통과한다 (렌더러가 마우스 위치를 보고 setIgnore 를 부른다).
//   npm run app            → 로컬 파일 + 기본 서버
//   SOCCER_SERVER=http://localhost:3140 npm run app

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');

const BAR_H = 150;
const BIG_H = 780;
let win = null;
let tray = null;
let expanded = false;

app.setPath('userData', path.join(app.getPath('appData'), 'soccer-star'));

function bounds(big) {
  const wa = screen.getPrimaryDisplay().workArea;
  const h = big ? Math.min(BIG_H, wa.height) : BAR_H;
  return { x: wa.x, y: wa.y + wa.height - h, width: wa.width, height: h };
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
  const query = process.env.SOCCER_SERVER ? { server: process.env.SOCCER_SERVER } : {};
  win.loadFile(path.join(__dirname, '..', 'index.html'), { query });
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

function makeTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('축구선수 키우기');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '보이기 / 숨기기', click: () => (win.isVisible() ? win.hide() : win.show()) },
    { label: '캠프 열기', click: () => { win.show(); win.webContents.executeJavaScript('UI.openCamp()'); } },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]));
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  create();
  makeTray();
});
app.on('window-all-closed', () => app.quit());
