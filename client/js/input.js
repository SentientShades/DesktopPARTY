let hook = null;
let nut = null;

try { hook = require('uiohook-napi'); }
catch { console.log('uiohook-napi not installed — click capture unavailable'); }

try { nut = require('@nut-tree-fork/nut-js'); }
catch { console.log('nut-js not installed — remote click injection unavailable'); }

const available = { send: !!hook, receive: !!nut };

let running = false;
let onleft = null;
let onright = null;

function handle(e) {
  const point = { rawx: e.x, rawy: e.y };
  if (e.button === 2) onright?.(point);
  else if (e.button === 1) onleft?.(point);
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

module.exports = { available, start, stop, setleft, setright, inject };
