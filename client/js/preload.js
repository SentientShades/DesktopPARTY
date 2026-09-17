const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  setignoremouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  drawmode:       (active) => ipcRenderer.send('draw:mode', active),
  playeractive:   (active) => ipcRenderer.send('player:active', active),
  menuactive:     (active) => ipcRenderer.send('menu:active', active),
  requestfocus:   ()       => ipcRenderer.send('request-focus'),
  release:        ()       => ipcRenderer.send('app:release'),
  setstate:       (s)      => ipcRenderer.send('presence:state', s),

  getwebviewpreloadpath: () => ipcRenderer.invoke('get-webview-preload-path'),
  vendortext: (name) => ipcRenderer.invoke('vendor:text', name),

  stageopen:  (url) => ipcRenderer.invoke('stage:open', url),
  stagego:    (url) => ipcRenderer.invoke('stage:go', url),
  stageclose: ()    => ipcRenderer.send('stage:close'),
  stageinput: (ev)  => ipcRenderer.send('stage:input', ev),

  ontoast:       (h)   => ipcRenderer.on('toast:show', (_e, o) => h(o)),
  ontoastclick:  (id)  => ipcRenderer.send('toast:clicked', id),

  signal:        (msg) => ipcRenderer.send('signal:send', msg),
  onsignal:      (h)   => ipcRenderer.on('signal:recv', (_e, m) => h(m)),

  onlocalcursor: (h)   => ipcRenderer.on('cursor:local', (_e, p) => h(p)),
  onlocalclick:  (h)   => ipcRenderer.on('click:local', (_e, p) => h(p)),
  onmenu:        (h)   => ipcRenderer.on('menu:open', (_e, p) => h(p)),
  onactivity:    (h)   => ipcRenderer.on('activity:local', (_e, a) => h(a)),
  remoteclick:   (p)   => ipcRenderer.send('click:remote', p),

  onidentity:    (h)   => ipcRenderer.on('peer:identity', (_e, i) => h(i)),
  onroster:      (h)   => ipcRenderer.on('party:roster', (_e, r) => h(r)),
  onsettings:    (h)   => ipcRenderer.on('settings:update', (_e, s) => h(s)),
  onprofile:     (h)   => ipcRenderer.on('profile:update', (_e, p) => h(p))
});

contextBridge.exposeInMainWorld('launcher', {
  start:          (o) => ipcRenderer.invoke('app:start', o),
  session:        ()  => ipcRenderer.invoke('app:session'),
  close:          ()  => ipcRenderer.send('app:close'),
  minimize:       ()  => ipcRenderer.send('app:minimize'),

  getstore:       ()  => ipcRenderer.invoke('store:get'),
  inputavailable: ()  => ipcRenderer.invoke('input:available'),

  getprofile:     ()      => ipcRenderer.invoke('store:getProfile'),
  setprofile:     (patch) => ipcRenderer.invoke('store:setProfile', patch),
  pickavatar:     ()      => ipcRenderer.invoke('profile:pickAvatar'),
  pickcharacter:  ()      => ipcRenderer.invoke('profile:pickCharacter'),
  setsetting:     (key, value) => ipcRenderer.invoke('store:setSetting', { key, value }),

  hoststart:      () => ipcRenderer.invoke('host:start'),
  hoststop:       () => ipcRenderer.invoke('host:stop'),
  hoststatus:     () => ipcRenderer.invoke('host:status'),

  leaveparty:     ()  => ipcRenderer.send('party:leave'),

  onroster:        (h) => ipcRenderer.on('party:roster', (_e, r) => h(r)),
  onerror:         (h) => ipcRenderer.on('app:error', (_e, m) => h(m)),
  onsessionended:  (h) => ipcRenderer.on('session:ended', () => h())
});
