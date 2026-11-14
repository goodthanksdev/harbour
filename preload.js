// The only things Harbour's screen can ask the main process to do.
const { contextBridge, ipcRenderer } = require('electron');

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const on = channel => fn => ipcRenderer.on(channel, (_e, p) => fn(p));

contextBridge.exposeInMainWorld('api', {
  // settings and library
  getConfig: () => call('config:get'),
  setConfig: cfg => call('config:set', cfg),
  scan: (withReport, options) => call('library:scan', withReport, options),
  cachedLibrary: () => call('library:cached'),
  libraryUi: () => call('library:ui'),
  saveLibraryUi: patch => call('library:saveUi', patch),
  onLibraryInfo: on('library:info'),
  pickFolder: title => call('dialog:folder', title),
  addGameFolder: options => call('harbour:addGameFolder', options),
  removeGameFolder: options => call('harbour:removeGameFolder', options),
  // games
  launch: (id, options) => call('game:launch', id, options),
  quitGame: () => call('game:quit'),
  onGameStarted: on('game:started'),
  onGameEnded: on('game:ended'),
  setFavorite: options => call('game:setFavorite', options),
  setHidden: options => call('game:setHidden', options),
  setTitle: options => call('game:setTitle', options),
  openGameFolder: id => call('game:openFolder', id),
  chooseGameExecutable: id => call('game:chooseExecutable', id),
  gameAdd: options => call('game:add', options),
  gameRemove: id => call('game:remove', id),
  addPort: options => call('harbour:addPort', options),
  // emulators
  emuList: () => call('emu:list'),
  emuOpenFolder: id => call('emu:openFolder', id),
  emuPickExe: id => call('emu:pickExe', id),
  emuRemove: id => call('emu:remove', id),
  addEmulator: options => call('harbour:addEmulator', options),
  setEmulator: options => call('harbour:setEmulator', options),
  setSystemEmulator: options => call('harbour:setSystemEmulator', options),
  setEmulatorSource: options => call('harbour:setEmulatorSource', options),
  checkEmulators: force => call('harbour:checkEmulators', force),
  openEmulatorPage: id => call('harbour:openEmulatorPage', id),
  emuUpdate: id => call('harbour:emuUpdate', id),
  // recomp updates
  recompGet: id => call('recomp:get', id),
  recompSet: opts => call('recomp:set', opts),
  recompCheck: (id, force) => call('recomp:check', id, force),
  recompCheckAll: force => call('recomp:checkAll', force),
  recompUpdate: id => call('recomp:update', id),
  recompOpenPage: id => call('recomp:openPage', id),
  onRecompProgress: on('recomp:progress'),
  // artwork and videos
  artStart: options => call('art:start', options),
  onArtProgress: on('art:progress'),
  videoStart: options => call('video:start', options),
  videoStatus: () => call('video:status'),
  onVideoProgress: on('video:progress'),
  // window
  isFullscreen: () => call('app:fullscreen'),
  setFullscreen: on => call('app:setFullscreen', on),
  onToast: on('toast'),
  quitApp: () => ipcRenderer.send('app:quit'),
});
