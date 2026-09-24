const { app, BrowserWindow, screen, ipcMain, dialog, nativeImage, Tray, Menu, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const { toasts, presence, store, input, activity, localserver, tunnel, discord, lan } = require('./backend');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

let launcherwin;
let win;
let tray = null;
let cursortimer = null;

let userid = null;
let hosting = null;
let lastmembers = [];
let startedat = 0;
let partycode = null;
let stagewin = null;
let doingnow = '';

const appicon = path.join(__dirname, '..', 'assets', 'appicon_512x512.ico');
let faces = {};

const active = () => !!userid || !!hosting;
function watcherrors(w) {
  w.webContents.on('preload-error', (_e, file, error) => {
    console.error('[preload error]', file, error);
    dialog.showErrorBox('Preload script failed', `${file}\n\n${error.message}\n\n${error.stack || ''}`);
  });
}

function focus() {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.show();
  win.focus();
  win.moveTop();
}


function presencedata(members) {
  const list = (members || []).filter(Boolean);
  const others = list.filter(id => id !== userid);
  const size = Math.max(1, list.length);

  if (!startedat) startedat = Date.now();

  const state = doingnow ? doingnow
    : others.length === 0
    ? 'Just hanging out'
    : others.length <= 3
      ? `With ${others.join(', ')}`
      : `With ${others.slice(0, 2).join(', ')} +${others.length - 2} more`;

  discord.setactivity({
    details: hosting ? 'Hosting a party' : 'In a party',
    state,
    timestamps: { start: startedat },
    party: { id: partycode || 'desktopparty', size: [size, 8] },
    assets: { large_image: 'party', large_text: 'DesktopPARTY!' },
    instance: false
  });
}

function trayicon() {
  return nativeImage.createFromPath(appicon);
}

function ensuretray() {
  if (tray) return;

  tray = new Tray(trayicon());
  tray.setToolTip('DesktopPARTY!');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open DesktopPARTY!', click: showlauncher },
    { type: 'separator' },
    { label: 'Quit', click: () => quitall() }
  ]));
  tray.on('click', showlauncher);
}

function showlauncher() {
  if (launcherwin && !launcherwin.isDestroyed()) {
    launcherwin.show();
    launcherwin.focus();
  } else {
    createlauncher();
  }
}

function createlauncher() {
  launcherwin = new BrowserWindow({

    width: 440,
    height: 760,
    frame: false,
    resizable: false,
    backgroundColor: '#131313',
    icon: appicon,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  watcherrors(launcherwin);
  launcherwin.loadFile(path.join(__dirname, '..', 'html', 'launcher.html'));
  launcherwin.on('closed', () => { launcherwin = null; });
}
function createoverlay() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;

  win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: appicon,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  watcherrors(win);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });

  toasts.attach(win);
  win.loadFile(path.join(__dirname, '..', 'html', 'toast.html'));
  win.showInactive();

  win.on('closed', () => {
    clearInterval(cursortimer);
    cursortimer = null;
    win = null;
  });

  starttracking();
}

function starttracking() {
  const { width, height } = screen.getPrimaryDisplay().bounds;

  clearInterval(cursortimer);
  cursortimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const pt = screen.getCursorScreenPoint();
    win.webContents.send('cursor:local', { x: pt.x / width, y: pt.y / height });
  }, 16);
}

const holds = { draw: false, player: false, menu: false };
const held = () => holds.draw || holds.player || holds.menu;

function hold(name, on) {
  if (!(name in holds)) return;
  holds[name] = !!on;
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!held(), { forward: true });
  if (on) focus();
}

const tooverlay = (ch, p) => {
  if (win && !win.isDestroyed()) win.webContents.send(ch, p);
};

const tolauncher = (ch, p) => {
  if (launcherwin && !launcherwin.isDestroyed()) launcherwin.webContents.send(ch, p);
};

function bindhook() {
  if (!input.available.send) return;

  input.setright(({ rawx, rawy }) => {
    if (!win || win.isDestroyed()) return;
    const area = screen.getPrimaryDisplay().workArea;
    focus();
    win.setIgnoreMouseEvents(false, { forward: true });
    tooverlay('menu:open', { x: rawx - area.x, y: rawy - area.y });
  });

  input.start();
  applycapture();
}

function applycapture() {
  const { sendMyClicks } = store.getall().settings;
  if (!input.available.send) return;

  input.setmenubutton(store.getall().settings.menuButton);

  if (sendMyClicks) {
    const { width, height } = screen.getPrimaryDisplay().bounds;
    input.setleft(({ rawx, rawy }) => {
      tooverlay('click:local', { x: rawx / width, y: rawy / height });
    });
  } else {
    input.setleft(null);
  }
}

if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'com.desktopfriends.app' : process.execPath);

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!stagewin || stagewin.isDestroyed()) {
      console.warn('[stage] display media requested with no stage window');
      return callback({});
    }
    const frame = stagewin.webContents.mainFrame;
    callback({ video: frame, audio: frame });
  }, { useSystemPicker: false });

  discord.start();
  createlauncher();
});

function stageclose() {
  if (stagewin && !stagewin.isDestroyed()) stagewin.destroy();
  stagewin = null;
}

ipcMain.handle('stage:open', async (_e, url) => {
  stageclose();

  const area = screen.getPrimaryDisplay().workArea;
  stagewin = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: 1280,
    height: 720,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    backgroundColor: '#000000',
    title: 'DesktopPARTY Stage',
    icon: appicon,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  stagewin.setMenu(null);
  stagewin.on('closed', () => { stagewin = null; });

  await stagewin.loadURL(url);
  stagewin.showInactive();
  focus();

  const size = stagewin.getContentSize();
  return { sourceid: stagewin.getMediaSourceId(), width: size[0], height: size[1] };
});

ipcMain.on('stage:input', (_e, ev) => {
  if (!stagewin || stagewin.isDestroyed()) return;
  try { stagewin.webContents.sendInputEvent(ev); } catch {}
});

ipcMain.handle('stage:go', async (_e, url) => {
  if (!stagewin || stagewin.isDestroyed()) return false;
  await stagewin.loadURL(url);
  focus();
  return true;
});

ipcMain.on('stage:close', () => stageclose());

ipcMain.on('stage:focus', (_e, sourceid) => {
  if (process.platform !== 'win32') return;
  const m = /^window:(\d+):/.exec(String(sourceid || ''));
  if (!m) return;

  const script =
    "Add-Type -Name w -Namespace dp -MemberDefinition '" +
    '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); ' +
    '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); ' +
    '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);' +
    "'; " +
    `$h = [IntPtr]${m[1]}; ` +
    'if ([dp.w]::IsIconic($h)) { [dp.w]::ShowWindow($h, 9) | Out-Null }; ' +
    '[dp.w]::SetForegroundWindow($h) | Out-Null';

  try {
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
      .on('error', () => {});
  } catch {}
});

ipcMain.handle('stage:sources', async () => {
  const mine = new Set();
  [win, launcherwin, stagewin].forEach(w => {
    if (w && !w.isDestroyed()) {
      try { mine.add(w.getMediaSourceId()); } catch {}
    }
  });

  const list = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false
  });

  return list
    .filter(src => !mine.has(src.id))
    .filter(src => src.name && !/^DesktopPARTY/i.test(src.name))
    .map(src => ({
      id: src.id,
      name: src.name,
      screen: src.id.startsWith('screen:'),
      thumb: src.thumbnail && !src.thumbnail.isEmpty() ? src.thumbnail.toDataURL() : ''
    }))
    .sort((a, b) => Number(a.screen) - Number(b.screen));
});

ipcMain.handle('vendor:text', (_e, name) => {
  const safe = path.basename(String(name));
  return fs.readFileSync(path.join(__dirname, '..', 'vendor', safe), 'utf8');
});

ipcMain.on('party:faces', (_e, f) => {
  faces = f || {};
  tolauncher('party:faces', faces);
});

ipcMain.handle('party:getfaces', () => faces);

ipcMain.handle('store:get', () => store.getall());
ipcMain.handle('store:getProfile', () => store.getprofile());
ipcMain.handle('input:available', () => input.available);
ipcMain.handle('app:session', () => ({ active: active(), userid, hosting }));

ipcMain.handle('store:setProfile', (_e, patch) => {
  const p = store.setprofile(patch);
  tooverlay('profile:update', store.getprofile());
  return p;
});

ipcMain.handle('store:setSetting', (_e, { key, value }) => {
  const settings = store.setsetting(key, value);
  tooverlay('settings:update', settings);
  if (key === 'sendMyClicks' || key === 'menuButton') applycapture();
  return settings;
});

ipcMain.handle('profile:pickAvatar', async () => {
  const res = await dialog.showOpenDialog(launcherwin, {
    title: 'Choose a profile picture',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths[0]) return null;

  const img = nativeImage.createFromPath(res.filePaths[0]).resize({ width: 128, height: 128 });
  const url = img.toDataURL();

  store.setprofile({ avatar: url });
  tooverlay('profile:update', store.getprofile());
  return url;
});

ipcMain.handle('profile:pickCharacter', async () => {
  const res = await dialog.showOpenDialog(launcherwin, {
    title: 'Choose a character picture',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths[0]) return null;

  const img = nativeImage.createFromPath(res.filePaths[0]).resize({ width: 96, height: 96 });
  const url = img.toDataURL();
  store.setprofile({ characterImage: url });
  tooverlay('profile:update', store.getprofile());
  return url;
});

function allowlan() {
  if (process.platform !== 'win32') return;
  const name = 'DesktopPARTY LAN';
  execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`], { windowsHide: true }, (err) => {
    if (!err) return;
    const args = `advfirewall firewall add rule name="${name}" dir=in action=allow program="${process.execPath}" enable=yes profile=any`;
    const cmd = `Start-Process -FilePath netsh -Verb RunAs -WindowStyle Hidden -ArgumentList '${args.replace(/'/g, "''")}'`;
    try {
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    } catch (e) {
      console.warn('[lan] firewall rule failed:', e.message);
    }
  });
}

function stophosting() {
  tunnel.stop();
  lan.stop();
  localserver.stop();
  hosting = null;
}


ipcMain.handle('host:start', async (_e, opts) => {
  const lanonly = !!opts?.lan;
  if (hosting && !!hosting.lan === lanonly) return hosting;
  if (hosting) stophosting();

  try {
    const port = await localserver.start(8080);

    if (lanonly) {
      const code = lan.makecode();
      await lan.start(code, port);
      const ip = await lan.address();
      hosting = { url: `ws://127.0.0.1:${port}`, code, lan: true, ip: ip ? (port === 8080 ? ip : `${ip}:${port}`) : null };
      allowlan();
    } else {
      const { url, code } = await tunnel.start(port);
      hosting = { url, code, lan: false };
    }

    partycode = hosting.code;
    store.setsetting('serverUrl', hosting.url);
    ensuretray();
    return hosting;
  } catch (e) {
    stophosting();
    throw new Error(e.message);
  }
});

ipcMain.handle('host:stop', () => {
  stophosting();
  return true;
});

ipcMain.handle('lan:find', (_e, code) => lan.find(code));

ipcMain.handle('host:status', () => hosting);

ipcMain.handle('app:start', async (_e, { userid: id, serverurl, code }) => {
  userid = String(id).trim();
  store.setuserid(userid);
  lastmembers = [];
  startedat = 0;

  if (serverurl) store.setsetting('serverUrl', serverurl);
  const url = store.getall().settings.serverUrl;
  if (!url) throw new Error('No server. Host a party or enter a code.');

  const match = /\/\/([a-z][a-z0-9-]*)\./i.exec(url);
  partycode = code || hosting?.code || (match ? match[1] : partycode);

  if (!win || win.isDestroyed()) createoverlay();

  await new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };

    presence.connectsignal(userid, url, (msg) => tooverlay('signal:recv', msg), done);
    setTimeout(done, 4000);
  });

  presence.connect(userid, url, {
    onroster: (msg) => {
      const members = msg.members || [];
      const joined = members.filter(id => id !== userid && !lastmembers.includes(id));
      const left   = lastmembers.filter(id => id !== userid && !members.includes(id));

      joined.forEach(id => toasts.show({ id, name: id, activity: 'joined the party', status: 'online' }));
      left.forEach(id   => toasts.show({ id, name: id, activity: 'left the party', status: 'offline' }));

      lastmembers = members;
      presencedata(members);

      tooverlay('party:roster', { myid: userid, ...msg });
      tolauncher('party:roster', msg);
    },
    onerror: (msg) => tolauncher('app:error', msg)
  });

  const boot = () => {
    tooverlay('peer:identity', { userid });
    tooverlay('settings:update', store.getall().settings);
    tooverlay('profile:update', store.getprofile());
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', boot);
  else boot();

  bindhook();
  activity.start((a) => tooverlay('activity:local', a));
  presencedata([userid]);

  ensuretray();
  return { ok: true, userid, serverurl: url };
});

function endsession() {
  userid = null;
  stophosting();
  faces = {};
  lastmembers = [];
  startedat = 0;
  partycode = null;

  holds.draw = false;
  holds.player = false;
  holds.menu = false;

  stageclose();
  presence.disconnect();
  activity.stop();
  input.stop();
  discord.clearactivity();

  if (win && !win.isDestroyed()) win.close();

  tolauncher('session:ended', {});
}

ipcMain.on('party:leave', () => {
  presence.send({ type: 'party:leave' });
  endsession();
});

ipcMain.on('presence:state', (_e, text) => {
  doingnow = text || '';
  presencedata(lastmembers.length ? lastmembers : [userid]);
});

ipcMain.on('request-focus', () => focus());

ipcMain.on('app:release', () => {
  holds.draw = false;
  holds.player = false;
  holds.menu = false;
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(true, { forward: true });
  win.blur();
});

ipcMain.on('draw:mode',     (_e, on) => hold('draw', on));
ipcMain.on('player:active', (_e, on) => hold('player', on));
ipcMain.on('menu:active',   (_e, on) => hold('menu', on));

ipcMain.on('set-ignore-mouse', (_e, ignore) => {
  if (!win || win.isDestroyed()) return;
  if (!ignore) {
    win.setIgnoreMouseEvents(false, { forward: true });
    return;
  }
  if (held()) return;
  win.setIgnoreMouseEvents(true, { forward: true });
});

ipcMain.on('click:remote', async (_e, { x, y }) => {
  if (!store.getall().settings.allowRemoteClicks) return;
  const { width, height } = screen.getPrimaryDisplay().bounds;
  await input.inject(x * width, y * height);
});

ipcMain.on('app:minimize', () => launcherwin?.minimize());

ipcMain.on('app:close', () => {
  if (userid) {
    launcherwin?.minimize();
    return;
  }
  quitall();
});


function quitall() {
  shutdown();
  if (win && !win.isDestroyed()) win.destroy();
  if (launcherwin && !launcherwin.isDestroyed()) launcherwin.destroy();
  setTimeout(() => app.exit(0), 1500);
  app.quit();
}

ipcMain.on('toast:clicked', (_e, id) => console.log('clicked toast', id));
ipcMain.on('signal:send', (_e, msg) => presence.sendsignal(msg));

function shutdown() {
  try { stageclose(); } catch {}
  try { activity.stop(); } catch {}
  try { lan.stop(); } catch {}
  try { tunnel.stop(); } catch {}
  try { localserver.stop(); } catch {}
  try { input.stop(); } catch {}
  try { discord.stop(); } catch {}
  try { tray?.destroy(); } catch {}
  tray = null;
}

app.on('before-quit', shutdown);

app.on('window-all-closed', () => {
  shutdown();
  if (process.platform !== 'darwin') app.quit();
});
