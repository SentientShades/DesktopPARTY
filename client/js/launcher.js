const pick = (id) => document.getElementById(id);

let myid = null;
let mode = 'join';
let host = null;

let members = [];
let faces = {};

let myavatar = '';

const colors = ['#23d18b','#3a8ef0','#ffd24a','#e0508c','#9b6cf0','#22c8c8','#f06a3a','#c0c0c0'];

function hashed(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function themed(p) {
  return p.accent || hashed(p.userid || p.displayName || 'guest');
}
function accent(hex) {
  document.documentElement.style.setProperty('--green', hex);
}

function status(el, text, kind = '') {
  el.textContent = text;
  el.className = `status ${kind}`;
}

pick('win-close').addEventListener('click', () => window.launcher.close());
pick('win-min').addEventListener('click', () => window.launcher.minimize());

document.querySelectorAll('[data-close]').forEach(btn => {

  btn.addEventListener('click', () => pick(btn.dataset.close).classList.add('hidden'));
});

pick('open-settings').addEventListener('click', () => pick('settings-sheet').classList.remove('hidden'));
pick('open-profile').addEventListener('click', () => pick('profile-sheet').classList.remove('hidden'));


function tohex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function tohue(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return null;
  const [r, g, b] = m.slice(1).map(v => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;

  let h;
  if (max === r)      h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}

function paint(hex) {
  pick('accent-preview').style.setProperty('--accent-c', hex);
  pick('accent-hue').style.setProperty('--thumb', hex);
}

function setmode(next) {
  mode = next;
  pick('tab-join').classList.toggle('active', next === 'join');
  pick('tab-host').classList.toggle('active', next === 'host');
  pick('join-pane').classList.toggle('hidden', next !== 'join');
  pick('host-pane').classList.toggle('hidden', next !== 'host');
}
pick('tab-join').addEventListener('click', () => setmode('join'));
pick('tab-host').addEventListener('click', () => setmode('host'));


pick('host-btn').addEventListener('click', async () => {
  const btn = pick('host-btn');
  const lanonly = pick('host-lan').checked;

  btn.disabled = true;
  pick('host-lan').disabled = true;
  btn.textContent = lanonly ? 'Starting…' : 'Starting tunnel…';
  status(pick('signin-status'), '');

  try {
    host = await window.launcher.hoststart({ lan: lanonly });
    pick('host-code').textContent = host.code;
    pick('host-info').classList.remove('hidden');
    btn.textContent = 'Hosting';
    pick('host-hint').textContent = host.lan
      ? `Your party is live on this network only. Sign in below to join it.${host.ip ? ` If the code cant be found, friends can type ${host.ip} instead.` : ''}`
      : 'Your party is live. Sign in below to join it.';
  } catch (e) {
    btn.disabled = false;
    pick('host-lan').disabled = false;
    btn.textContent = 'Start hosting';
    status(pick('signin-status'), e.message, 'error');
  }
});

pick('copy-code').addEventListener('click', () => {
  navigator.clipboard.writeText(pick('host-code').textContent);
  status(pick('signin-status'), 'Code copied', 'ok');
});

pick('banner-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(pick('banner-code').textContent);
  status(pick('status'), 'Code copied', 'ok');
});

function enter() {
  pick('signin').classList.add('hidden');
  pick('home').classList.remove('hidden');
  pick('win-close').classList.add('hidden');
  window.launcher.getfaces().then(f => { faces = f || {}; draw(); });

  if (host) {
    pick('banner-label').textContent = host.lan ? 'Hosting LAN' : 'Hosting';
    pick('banner-code').textContent = host.code;
    pick('hosting-banner').classList.remove('hidden');
  }
}

async function signin() {
  const userid = pick('username').value.trim();
  if (!userid) return status(pick('signin-status'), 'Enter a user ID first', 'error');

  let serverurl = null;
  let code = null;
  if (mode === 'host') {
    if (!host) return status(pick('signin-status'), 'Start hosting first', 'error');
    serverurl = host.url;
    code = host.code;
  } else {
    code = pick('join-code').value.trim().toLowerCase();
    if (!code) return status(pick('signin-status'), 'Enter a party code', 'error');
  }

  pick('go').disabled = true;
  status(pick('signin-status'), 'Connecting…');

  if (mode !== 'host') {
    const direct = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{2,5}))?$/.exec(code);
    if (code.startsWith('ws://') || code.startsWith('wss://')) {
      serverurl = code;
      code = null;
    } else if (direct) {
      serverurl = `ws://${direct[1]}:${direct[2] || 8080}`;
      code = null;
    } else {
      const local = await window.launcher.lanfind(code).catch(() => null);
      serverurl = local || `wss://${code}.trycloudflare.com`;
    }
  }

  try {
    await window.launcher.start({ userid, serverurl, code });
    myid = userid;
    enter();
    await refresh();
  } catch (e) {
    status(pick('signin-status'), `Failed: ${e.message}`, 'error');
    pick('go').disabled = false;
  }
}
pick('go').addEventListener('click', signin);
pick('username').addEventListener('keydown', e => { if (e.key === 'Enter') signin(); });
pick('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') signin(); });

async function refresh() {
  const p = await window.launcher.getprofile();
  pick('me-name').textContent = p.displayName || p.userid;
  pick('display-name').value = p.displayName || '';

  myavatar = p.avatar || '';
  const face = p.avatar ? `url('${p.avatar}')` : '';
  pick('me-avatar').style.backgroundImage = face;
  draw();
  pick('avatar-preview').style.backgroundImage = face;
  pick('brand-avatar').style.backgroundImage = face;
  pick('brand-avatar').classList.toggle('has-avatar', !!p.avatar);

  if (p.characterImage) {
    pick('character-preview').style.backgroundImage = `url('${p.characterImage}')`;
  } else {
    pick('character-preview').style.backgroundImage = '';
  }

  const hue = tohue(p.accent);
  if (hue !== null) pick('accent-hue').value = hue;

  const hex = themed(p);
  paint(hex);
  accent(hex);
}


pick('pick-avatar').addEventListener('click', async () => {
  const url = await window.launcher.pickavatar();
  if (!url) return;
  pick('avatar-preview').style.backgroundImage = `url('${url}')`;
  pick('me-avatar').style.backgroundImage = `url('${url}')`;
  pick('brand-avatar').style.backgroundImage = `url('${url}')`;
  pick('brand-avatar').classList.add('has-avatar');
  myavatar = url;
  draw();
  status(pick('profile-status'), 'Picture updated', 'ok');
});

pick('pick-character').addEventListener('click', async () => {
  const url = await window.launcher.pickcharacter();
  if (!url) return;
  pick('character-preview').style.backgroundImage = `url('${url}')`;
  status(pick('profile-status'), 'Character picture updated', 'ok');
});

pick('clear-character').addEventListener('click', async () => {
  await window.launcher.setprofile({ characterImage: '' });
  pick('character-preview').style.backgroundImage = '';
  status(pick('profile-status'), 'Character back to solid color', 'ok');
});

pick('accent-hue').addEventListener('input', () => {
  const hex = tohex(Number(pick('accent-hue').value), 0.85, 0.5);
  paint(hex);
  accent(hex);
  window.launcher.setprofile({ accent: hex });
});

pick('accent-reset').addEventListener('click', async () => {
  await window.launcher.setprofile({ accent: '' });
  await refresh();
  status(pick('profile-status'), 'Using automatic colour', 'ok');
});

pick('save-profile').addEventListener('click', async () => {
  await window.launcher.setprofile({ displayName: pick('display-name').value.trim() });
  await refresh();
  status(pick('profile-status'), 'Saved', 'ok');
});

pick('leave-party').addEventListener('click', () => window.launcher.leaveparty());

function draw() {
  const list = pick('party-list');
  list.innerHTML = '';
  list.classList.toggle('is-empty', members.length === 0);
  pick('party-count').textContent = `${members.length}/8`;
  pick('leave-party').disabled = members.length === 0;

  members.forEach(name => {
    const row = document.createElement('div');
    row.className = 'item';

    const info = faces[name] || {};
    const pic = name === myid ? (myavatar || info.avatar) : info.avatar;

    const av = document.createElement('span');
    av.className = 'avatar-sm online';
    av.style.borderColor = info.color || (name === myid ? themed({ userid: myid }) : hashed(name));
    if (pic) av.style.backgroundImage = `url('${pic}')`;

    const label = document.createElement('span');
    label.className = 'item-name';
    label.textContent = info.name || name;

    row.append(av, label);
    if (name === myid) {
      const you = document.createElement('span');
      you.className = 'you-tag';
      you.textContent = 'you';
      row.appendChild(you);
    }
    list.appendChild(row);
  });
}

window.launcher.onroster(r => {
  members = r.members || [];
  draw();
  refresh();
});

window.launcher.onfaces(f => {
  faces = f || {};
  draw();
});

window.launcher.onerror(m => status(pick('status'), m.message, 'error'));

window.launcher.onsessionended(() => {
  myid = null;
  host = null;
  members = [];
  faces = {};
  pick('win-close').classList.remove('hidden');

  pick('home').classList.add('hidden');
  pick('hosting-banner').classList.add('hidden');
  pick('host-info').classList.add('hidden');
  pick('host-btn').disabled = false;
  pick('host-lan').disabled = false;
  pick('host-btn').textContent = 'Start hosting';
  pick('host-hint').textContent = 'host the server on your pc';
  pick('go').disabled = false;

  pick('signin').classList.remove('hidden');
  status(pick('signin-status'), 'Left the party', 'ok');
  pick('username').focus();
});

async function settings() {
  const store = await window.launcher.getstore();
  const input = await window.launcher.inputavailable();

  ['showNames', 'allowDrawing', 'sendMyClicks', 'allowRemoteClicks'].forEach(key => {
    const el = pick(`set-${key}`);
    el.checked = !!store.settings[key];
    el.addEventListener('change', () => window.launcher.setsetting(key, el.checked));
  });

  const menubutton = pick('set-menuButton');
  const paintmenu = (value) => {
    menubutton.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.value === value));
  };
  paintmenu(store.settings.menuButton || 'right');
  menubutton.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      paintmenu(b.dataset.value);
      window.launcher.setsetting('menuButton', b.dataset.value);
    });
  });

  const server = pick('set-serverUrl');
  server.value = store.settings.serverUrl || '';
  server.addEventListener('change', () => {
    window.launcher.setsetting('serverUrl', server.value.trim());
  });
  pick('server-reset').addEventListener('click', () => {
    server.value = '';
    window.launcher.setsetting('serverUrl', '');
  });

  if (!input.send) pick('set-sendMyClicks').disabled = true;
  if (!input.receive) pick('set-allowRemoteClicks').disabled = true;
  if (!input.send || !input.receive) {
    pick('input-warn').textContent =
      'Clicks need native modules. Run: npm i uiohook-napi @nut-tree-fork/nut-js';
    pick('input-warn').classList.remove('hidden');
  }
}

async function boot() {
  const store = await window.launcher.getstore();

  if (store.userId) pick('username').value = store.userId;

  const p = await window.launcher.getprofile();
  accent(themed(p));
  if (p.avatar) {
    pick('brand-avatar').style.backgroundImage = `url('${p.avatar}')`;
    pick('brand-avatar').classList.add('has-avatar');
  }

  const session = await window.launcher.session();
  if (session.active && session.userid) {
    myid = session.userid;
    host = session.hosting || null;
    if (host) pick('host-lan').checked = !!host.lan;
    enter();
    await refresh();
  } else {
    pick('username').focus();
  }

  settings();
}

boot();
