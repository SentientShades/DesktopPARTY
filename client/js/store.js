const { app } = require('electron');
const fs = require('fs');
const path = require('path');

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

module.exports = { getall, getprofile, setuserid, setprofile, setsetting, file };
