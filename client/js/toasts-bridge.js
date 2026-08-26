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

module.exports = { attach, show };
