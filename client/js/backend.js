const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const dgram = require('dgram');
const { spawn, execSync } = require('child_process');
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');

const store = (() => {
  const dir  = app.getPath('userData');
  const file = path.join(dir, 'desktopfriends.json');
  const temp = file + '.tmp';

  const defaults = {
    userId: '',
    profile: { displayName: '', avatar: '', accent: '', characterImage: '' },

    settings: {
      showNames: true,
      allowRemoteClicks: false,
      allowDrawing: true,
      sendMyClicks: false,
      menuButton: 'right',
      serverUrl: ''
    }
  };

  let data = structuredClone(defaults);

  function load() {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const p = JSON.parse(raw);
      data = {
        ...structuredClone(defaults), ...p,
        profile:  { ...defaults.profile,  ...(p.profile  || {}) },
        settings: { ...defaults.settings, ...(p.settings || {}) }
      };
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error('[store] corrupt save file, backing up:', e.message);
        try { fs.copyFileSync(file, file + `.corrupt-${Date.now()}.bak`); } catch {}
      }
      data = structuredClone(defaults);
    }
    return data;
  }

  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(data, null, 2));
      fs.renameSync(temp, file);
    } catch (e) {
      console.error('store save failed:', e.message);
    }
  }

  const getall = () => data;

  const getprofile = () => ({
    userid: data.userId,
    displayName: data.profile.displayName || data.userId,
    avatar: data.profile.avatar || '',
    accent: data.profile.accent || '',
    characterImage: data.profile.characterImage || ''
  });

  function setuserid(id) { data.userId = id; save(); }

  function setprofile(patch) {
    data.profile = { ...data.profile, ...patch };
    save();
    return data.profile;
  }
  function setsetting(key, value) {
    if (!(key in defaults.settings)) return data.settings;
    data.settings[key] = value;
    save();
    return data.settings;
  }

  load();

  return { getall, getprofile, setuserid, setprofile, setsetting, file };
})();

const input = (() => {

  let hook = null;
  let nut = null;

  try { hook = require('uiohook-napi'); }
  catch { console.log('uiohook-napi not installed, click capture unavailable'); }

  try { nut = require('@nut-tree-fork/nut-js'); }
  catch { console.log('nut-js not installed, remote click injection unavailable'); }

  const available = { send: !!hook, receive: !!nut };

  let running = false;
  let onleft = null;
  let onright = null;
  let menubutton = 2;

  function handle(e) {
    const point = { rawx: e.x, rawy: e.y };
    if (e.button === menubutton) onright?.(point);
    else if (e.button === 1) onleft?.(point);
  }

  function setmenubutton(which) {
    menubutton = which === 'middle' ? 3 : 2;
  }

  function start() {
    if (!hook || running) return false;
    running = true;
    hook.uIOhook.on('mousedown', handle);
    hook.uIOhook.start();
    return true;
  }

  function stop() {
    if (!hook || !running) return;
    try { hook.uIOhook.off('mousedown', handle); } catch {}
    try { hook.uIOhook.stop(); } catch {}
    running = false;
    onleft = null;
    onright = null;
  }

  function setleft(fn) { onleft = fn; }
  function setright(fn) { onright = fn; }

  async function inject(x, y) {
    if (!nut) return false;
    try {
      const { mouse, Point, Button } = nut;
      mouse.config.mouseSpeed = 5000;
      await mouse.setPosition(new Point(Math.round(x), Math.round(y)));
      await mouse.click(Button.LEFT);
      return true;
    } catch (e) {
      console.warn('inject failed:', e.message);
      return false;
    }
  }

  return { available, start, stop, setleft, setright, setmenubutton, inject };
})();

const presence = (() => {
  const pingms = 15000;
  const maxwait = 30000;

  let sock, sigsock;
  let sockping = null, sigping = null;
  let sockwait = 1000, sigwait = 1000;

  let handlers = {};
  let closing = false;

  const sigqueue = [];
  const outqueue = [];

  function connect(userid, url, cbs = {}) {
    handlers = cbs;
    closing = false;

    sock = new WebSocket(`${url}/presence?userId=${encodeURIComponent(userid)}`, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });

    sock.on('open', () => {
      console.log('presence connected');
      sockwait = 1000;
      outqueue.splice(0).forEach(m => sock.send(JSON.stringify(m)));

      clearInterval(sockping);
      sockping = setInterval(() => {
        if (sock.readyState === WebSocket.OPEN) sock.ping();
      }, pingms);
    });

    sock.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {
        case 'party:roster': handlers.onroster?.(msg); break;
        case 'error':        handlers.onerror?.(msg); break;
      }
    });

    sock.on('close', () => {
      clearInterval(sockping);
      if (closing) return;
      console.log(`presence closed, retrying in ${sockwait}ms`);
      setTimeout(() => connect(userid, url, handlers), sockwait);
      sockwait = Math.min(sockwait * 2, maxwait);
    });

    sock.on('error', (e) => console.error('presence error:', e.message));
  }

  function send(msg) {
    if (sock?.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg));
    else outqueue.push(msg);
  }

  function connectsignal(userid, url, onsignal, onready) {
    sigsock = new WebSocket(`${url}/signal?userId=${encodeURIComponent(userid)}`, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });

    let first = true;

    sigsock.on('open', () => {
      console.log('signal connected');
      sigwait = 1000;
      const queued = sigqueue.splice(0);
      if (queued.length) console.log(`flushing ${queued.length} queued signal(s)`);
      queued.forEach(m => sigsock.send(JSON.stringify(m)));

      clearInterval(sigping);
      sigping = setInterval(() => {
        if (sigsock.readyState === WebSocket.OPEN) sigsock.ping();
      }, pingms);

      if (first) {
        first = false;
        onready?.();
      }
    });

    sigsock.on('message', (raw) => {
      try { onsignal(JSON.parse(raw)); }
      catch (e) { console.warn('bad signal', e); }
    });

    sigsock.on('close', () => {
      clearInterval(sigping);
      if (closing) return;
      setTimeout(() => connectsignal(userid, url, onsignal, null), sigwait);
      sigwait = Math.min(sigwait * 2, maxwait);
    });

    sigsock.on('error', (e) => console.error('signal error:', e.message));
  }

  function sendsignal(msg) {
    if (sigsock?.readyState === WebSocket.OPEN) sigsock.send(JSON.stringify(msg));
    else if (msg?.type !== 'relay') sigqueue.push(msg);
  }

  function disconnect() {
    closing = true;
    try { sock?.close(); } catch {}
    try { sigsock?.close(); } catch {}
    sock = null;
    sigsock = null;
    clearInterval(sockping);
    clearInterval(sigping);
    sockping = null;
    sigping = null;
    sockwait = 1000;
    sigwait = 1000;
    sigqueue.length = 0;
    outqueue.length = 0;
    handlers = {};
  }

  return { connect, send, connectsignal, sendsignal, disconnect };
})();

const toasts = (() => {
  let win = null;
  let ready = false;
  const pending = [];

  function attach(target) {
    win = target;
    ready = false;
    win.webContents.on('did-finish-load', () => {
      ready = true;
      pending.splice(0).forEach(o => win.webContents.send('toast:show', o));
    });
  }

  function show(opts) {
    if (!win || win.isDestroyed()) return;
    if (!ready) { pending.push(opts); return; }
    win.webContents.send('toast:show', opts);
  }

  return { attach, show };
})();

const activity = (() => {
  let winmod = null;
  try { winmod = require('get-windows'); }
  catch {
    try { winmod = require('active-win'); }
    catch { console.log('[activity] no window module, app detection off'); }
  }

  const known = {
    'chrome.exe': 'Chrome',
    'msedge.exe': 'Edge',
    'firefox.exe': 'Firefox',
    'Code.exe': 'VS Code',
    'devenv.exe': 'Visual Studio',
    'explorer.exe': 'File Explorer',
    'Spotify.exe': 'Spotify',
    'Discord.exe': 'Discord',
    'steam.exe': 'Steam',
    'javaw.exe': 'Minecraft',
    'RobloxPlayerBeta.exe': 'Roblox',
    'VALORANT-Win64-Shipping.exe': 'VALORANT',
    'League of Legends.exe': 'League of Legends',
    'DesktopFriends.exe': 'DesktopFriends'
  };

  let timer = null;
  let last = '';

  function friendly(owner) {
    const exe = owner?.name || '';
    return known[exe] || exe.replace(/\.exe$/i, '') || 'Unknown';
  }

  async function poll(onchange) {
    if (!winmod) return;
    try {
      const fn = winmod.activeWindow || winmod.default || winmod;
      const w = await fn();
      if (!w) return;

      const app = friendly(w.owner);
      const title = (w.title || '').slice(0, 60);

      const key = `${app}|${title}`;
      if (key === last) return;
      last = key;

      onchange({ app, details: title });
    } catch {}
  }

  function start(onchange, every = 3000) {
    if (timer) return;
    timer = setInterval(() => poll(onchange), every);
    poll(onchange);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    last = '';
  }

  const available = () => !!winmod;

  return { start, stop, available };
})();

const discord = (() => {
  const ops = { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 };

  const clientid = '1541222990224687184';

  let socket = null;
  let ready = false;
  let timer = null;
  let pending = null;
  let nonce = 0;

  function pipe(n) {
    return process.platform === 'win32'
      ? `\\\\.\\pipe\\discord-ipc-${n}`
      : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || os.tmpdir()}/discord-ipc-${n}`;
  }

  function encode(op, data) {
    const json = Buffer.from(JSON.stringify(data), 'utf8');
    const head = Buffer.alloc(8);
    head.writeInt32LE(op, 0);
    head.writeInt32LE(json.length, 4);
    return Buffer.concat([head, json]);
  }

  function connect(n = 0) {
    if (n > 9) {
      retry();
      return;
    }

    const sock = net.createConnection(pipe(n));
    let buf = Buffer.alloc(0);

    sock.on('connect', () => {
      socket = sock;
      sock.write(encode(ops.handshake, { v: 1, client_id: clientid }));
    });

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8) {
        const op = buf.readInt32LE(0);
        const len = buf.readInt32LE(4);
        if (buf.length < 8 + len) break;

        const body = buf.subarray(8, 8 + len).toString('utf8');
        buf = buf.subarray(8 + len);

        let payload;
        try { payload = JSON.parse(body); } catch { continue; }

        if (op === ops.ping) {
          sock.write(encode(ops.pong, payload));
        } else if (payload.evt === 'READY') {
          ready = true;
          console.log('[discord] connected as', payload.data?.user?.username || 'unknown');
          if (pending) setactivity(pending);
        } else if (payload.evt === 'ERROR') {
          console.log('[discord] error:', payload.data?.message);
        }
      }
    });

    sock.on('error', () => {
      sock.destroy();
      if (socket === sock) { socket = null; ready = false; }
      connect(n + 1);
    });

    sock.on('close', () => {
      if (socket === sock) {
        socket = null;
        ready = false;
        retry();
      }
    });
  }

  function retry() {
    clearTimeout(timer);
    timer = setTimeout(() => connect(0), 15000);
  }

  function setactivity(activity) {
    pending = activity;
    if (!ready || !socket) return;

    try {
      socket.write(encode(ops.frame, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity },
        nonce: String(++nonce)
      }));
    } catch (e) {
      console.log('[discord] write failed:', e.message);
    }
  }

  function clearactivity() {
    pending = null;
    if (!ready || !socket) return;
    try {
      socket.write(encode(ops.frame, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity: null },
        nonce: String(++nonce)
      }));
    } catch {}
  }

  function start() {
    if (!clientid || clientid.startsWith('0000')) {
      console.log('[discord] no client id set, rich presence disabled');
      return;
    }
    connect(0);
  }

  function stop() {
    clearTimeout(timer);
    clearactivity();
    try { socket?.destroy(); } catch {}
    socket = null;
    ready = false;
  }

  return { start, setactivity, clearactivity, stop };
})();


const tunnel = (() => {
  let proc = null;

  function binary() {
    const name = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

    const packed = process.resourcesPath
      ? path.join(process.resourcesPath, 'bin', name)
      : null;
    if (packed && fs.existsSync(packed)) return packed;

    const dev = path.join(app.getAppPath(), 'bin', name);
    if (fs.existsSync(dev)) return dev;

    return name;
  }

  function start(port) {
    return new Promise((resolve, reject) => {
      if (proc) return reject(new Error('Tunnel already running'));

      const bin = binary();
      console.log('[tunnel] launching', bin);

      proc = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`], {
        windowsHide: true
      });

      let settled = false;

      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };

      const timer = setTimeout(() => {
        stop();
        finish(reject, new Error('Tunnel timed out after 30s'));
      }, 30000);

      const scan = (buf) => {
        const text = buf.toString();
        const m = text.match(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/i);
        if (m) {
          console.log('[tunnel] url:', m[0]);
          finish(resolve, { url: `wss://${m[1]}.trycloudflare.com`, code: m[1] });
        }
      };

      proc.stdout.on('data', scan);
      proc.stderr.on('data', scan);

      proc.on('error', (e) => {
        proc = null;
        finish(reject, new Error(
          e.code === 'ENOENT'
            ? 'cloudflared not found, place cloudflared.exe in the bin folder'
            : e.message
        ));
      });

      proc.on('exit', (code) => {
        console.log('[tunnel] exited', code);
        proc = null;
        finish(reject, new Error('Tunnel closed unexpectedly'));
      });
    });
  }

  function stop() {
    if (!proc) return;
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
      } else {
        proc.kill();
      }
    } catch {}
    proc = null;
  }

  return { start, stop, isrunning: () => !!proc };
})();

const localserver = (() => {
  const maxparty = 8;

  let server = null;
  let sockets = null;
  let timer = null;
  let mainparty = null;

  const clients = new Map();
  const signals = new Map();
  const queued = new Map();
  const parties = new Map();
  const membership = new Map();

  function send(sock, obj) {
    if (sock && sock.readyState === 1) sock.send(JSON.stringify(obj));
  }

  function newid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function roster(party) {
    const members = parties.get(party);
    return {
      type: 'party:roster',
      partyId: members ? party : null,
      members: members ? [...members].sort() : []
    };
  }

  function announce(party) {
    const members = parties.get(party);
    if (!members) return;
    const payload = roster(party);
    members.forEach(id => send(clients.get(id), payload));
  }

  function join(userid) {
    if (!mainparty || !parties.has(mainparty)) {
      mainparty = newid();
      parties.set(mainparty, new Set());
    }

    const members = parties.get(mainparty);
    if (members.size >= maxparty) {
      send(clients.get(userid), { type: 'error', message: `Party is full (${maxparty} max)` });
      return;
    }

    members.add(userid);
    membership.set(userid, mainparty);
    console.log(`[host] auto-joined: ${userid} -> ${mainparty} (${members.size}/${maxparty})`);
    announce(mainparty);
  }

  function leave(userid) {
    const party = membership.get(userid);
    if (!party) return;
    membership.delete(userid);

    const members = parties.get(party);
    if (members) {
      members.delete(userid);
      if (members.size === 0) {
        parties.delete(party);
        if (mainparty === party) mainparty = null;
        console.log(`[host] party disbanded: ${party}`);
      } else {
        announce(party);
      }
    }
    send(clients.get(userid), { type: 'party:roster', partyId: null, members: [] });
  }

  function onpresence(sock, userid) {
    clients.set(userid, sock);
    console.log(`[host] presence connect: ${userid} (${clients.size} online)`);
    join(userid);

    sock.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'party:leave') leave(userid);
    });

    sock.on('close', () => {
      if (clients.get(userid) === sock) {
        clients.delete(userid);
        leave(userid);
        console.log(`[host] presence close: ${userid}`);
      }
    });

    sock.on('error', (e) => console.log('[host] presence error:', e.message));
  }

  function onsignal(sock, userid) {
    signals.set(userid, sock);
    console.log(`[host] signal connect: ${userid}`);

    const held = queued.get(userid);
    if (held?.length) {
      console.log(`[host] flushing ${held.length} queued signal(s) to ${userid}`);
      held.forEach(msg => send(sock, msg));
      queued.delete(userid);
    }

    sock.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg.to) return;

      msg.from = userid;
      const target = signals.get(msg.to);

      if (msg.type === 'relay') {
        if (target) send(target, msg);
        return;
      }

      if (target) {
        console.log(`[host] signal ${msg.type}: ${userid} -> ${msg.to}  OK`);
        send(target, msg);
      } else {
        console.log(`[host] signal ${msg.type}: ${userid} -> ${msg.to}  QUEUED`);
        if (!queued.has(msg.to)) queued.set(msg.to, []);
        const q = queued.get(msg.to);
        q.push(msg);
        if (q.length > 50) q.shift();
      }
    });

    sock.on('close', () => {
      if (signals.get(userid) === sock) {
        signals.delete(userid);
        console.log(`[host] signal close: ${userid}`);
      }
    });

    sock.on('error', (e) => console.log('[host] signal error:', e.message));
  }

  function start(port = 8080) {
    return new Promise((resolve, reject) => {
      if (server) return resolve(port);

      server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('DesktopPARTY host\n');
      });

      sockets = new WebSocketServer({ noServer: true });

      server.on('upgrade', (req, socket, head) => {
        let url;
        try { url = new URL(req.url, 'http://localhost'); }
        catch { return socket.destroy(); }

        const userid = url.searchParams.get('userId');
        if (!userid) return socket.destroy();

        sockets.handleUpgrade(req, socket, head, (sock) => {
          if (url.pathname === '/presence') onpresence(sock, userid);
          else if (url.pathname === '/signal') onsignal(sock, userid);
          else sock.close();
        });
      });

      timer = setInterval(() => {
        sockets?.clients.forEach(c => { if (c.readyState === 1) c.ping(); });
      }, 15000);

      server.once('error', (e) => {
        clearInterval(timer);
        server = null;
        sockets = null;
        reject(new Error(
          e.code === 'EADDRINUSE' ? `Port ${port} is already in use` : e.message
        ));
      });

      server.listen(port, () => {
        console.log(`[host] listening on ${port}`);
        resolve(port);
      });
    });
  }

  function stop() {
    clearInterval(timer);
    timer = null;

    try { sockets?.clients.forEach(c => c.close()); } catch {}
    try { sockets?.close(); } catch {}
    try { server?.close(); } catch {}

    server = null;
    sockets = null;
    mainparty = null;
    clients.clear();
    signals.clear();
    queued.clear();
    parties.clear();
    membership.clear();
    console.log('[host] stopped');
  }

  return { start, stop, isrunning: () => !!server };
})();

const lan = (() => {

  const port = 41234;
  const words = [
    'apple', 'bagel', 'banjo', 'beach', 'berry', 'blimp', 'bongo', 'brick',
    'bubble', 'cactus', 'candle', 'cloud', 'cobra', 'comet', 'cookie', 'coral',
    'crumb', 'daisy', 'dingo', 'donut', 'dragon', 'falcon', 'fern', 'fizzy',
    'frog', 'gecko', 'ghost', 'goblin', 'grape', 'hippo', 'honey', 'igloo',
    'jelly', 'kazoo', 'kiwi', 'koala', 'lemon', 'llama', 'mango', 'marble',
    'melon', 'moose', 'muffin', 'nacho', 'noodle', 'otter', 'panda', 'pepper',
    'pickle', 'pixel', 'pizza', 'plum', 'potato', 'puffin', 'quartz', 'radish',
    'robot', 'rocket', 'sprout', 'taco', 'toast', 'tulip', 'waffle', 'yeti'
  ];

  let host = null;
  let hostcode = null;
  let hostport = 0;


  function makecode() {
    const pick = () => words[Math.floor(Math.random() * words.length)];
    return [pick(), pick(), pick(), pick()].join('-');
  }

  function clean(code) {
    return String(code || '').trim().toLowerCase();
  }

  function targets() {
    const out = new Set(['255.255.255.255']);
    Object.values(os.networkInterfaces()).flat().forEach(i => {
      if (!i || i.internal || (i.family !== 'IPv4' && i.family !== 4)) return;
      const ip = i.address.split('.').map(Number);
      const mask = i.netmask.split('.').map(Number);
      if (ip.length !== 4 || mask.length !== 4) return;
      out.add(ip.map((n, k) => (n & mask[k]) | (~mask[k] & 255)).join('.'));
    });
    return [...out];
  }

  function start(code, serverport) {
    return new Promise((resolve, reject) => {
      if (host) stop();

      hostcode = clean(code);
      hostport = serverport;
      host = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      host.on('message', (raw, rinfo) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.t !== 'dpfind' || clean(msg.code) !== hostcode) return;

        const reply = Buffer.from(JSON.stringify({ t: 'dphere', code: hostcode, port: hostport }));
        host.send(reply, rinfo.port, rinfo.address);
      });

      host.once('error', (e) => {
        stop();
        reject(new Error(e.code === 'EADDRINUSE' ? `LAN port ${port} is already in use` : e.message));
      });

      host.bind(port, '0.0.0.0', () => {
        console.log(`[lan] answering for ${hostcode} on udp ${port}`);
        resolve();
      });
    });
  }

  function find(code, waitms = 1000) {
    return new Promise((resolve) => {
      const wanted = clean(code);
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      let done = false;
      let pinger = null;

      const finish = (result) => {
        if (done) return;
        done = true;
        clearInterval(pinger);
        clearTimeout(timer);
        try { sock.close(); } catch {}
        resolve(result);
      };

      const timer = setTimeout(() => finish(null), waitms);

      sock.on('message', (raw, rinfo) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.t !== 'dphere' || clean(msg.code) !== wanted) return;
        finish(`ws://${rinfo.address}:${msg.port}`);
      });

      sock.on('error', () => finish(null));

      sock.bind(0, () => {
        try { sock.setBroadcast(true); } catch {}
        const query = Buffer.from(JSON.stringify({ t: 'dpfind', code: wanted }));
        const shout = () => targets().forEach(addr => {
          sock.send(query, port, addr, () => {});
        });
        shout();
        pinger = setInterval(shout, 250);
      });
    });
  }

  function stop() {
    try { host?.close(); } catch {}
    host = null;
    hostcode = null;
    hostport = 0;
  }

  function guessip() {
    const list = Object.entries(os.networkInterfaces()).flatMap(([name, all]) => (all || []).map(i => ({ name, ...i })));
    const good = list.filter(i => !i.internal && (i.family === 'IPv4' || i.family === 4) && !i.address.startsWith('169.254.'));
    const real = good.filter(i => !/vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|tailscale|zerotier|hamachi|loopback/i.test(i.name));
    return (real[0] || good[0])?.address || null;
  }

  function address() {
    return new Promise((resolve) => {
      let sock;
      try { sock = dgram.createSocket('udp4'); }
      catch { return resolve(guessip()); }

      const finish = (ip) => {
        try { sock.close(); } catch {}
        resolve(ip && ip !== '0.0.0.0' ? ip : guessip());
      };

      sock.once('error', () => finish(null));
      try {
        sock.connect(53, '8.8.8.8', () => {
          let ip = null;
          try { ip = sock.address().address; } catch {}
          finish(ip);
        });
      } catch {
        finish(null);
      }
    });
  }

  return { makecode, start, find, stop, address, isrunning: () => !!host };
})();

module.exports = { store, input, presence, toasts, activity, discord, tunnel, localserver, lan };
