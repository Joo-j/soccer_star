'use strict';
// 렌더러(ui.js)에서 window.soccerDesktop 으로 창을 다룬다.
const { contextBridge, ipcRenderer } = require('electron');

let last = null;
contextBridge.exposeInMainWorld('soccerDesktop', {
  setIgnore: (ignore) => { if (ignore !== last) { last = ignore; ipcRenderer.send('bar:ignore', ignore); } },
  expand: (big) => ipcRenderer.send('bar:expand', big),
  notify: (title, body) => ipcRenderer.send('bar:notify', { title, body }),
});
