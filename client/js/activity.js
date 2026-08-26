let winmod = null;
try { winmod = require('get-windows'); }
catch {
  try { winmod = require('active-win'); }
  catch { console.log('[activity] no window module — app detection off'); }
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

module.exports = { start, stop, available };
