const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

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
          ? 'cloudflared not found — place cloudflared.exe in the bin folder'
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
      require('child_process').execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill();
    }
  } catch {}
  proc = null;
}

module.exports = { start, stop, isrunning: () => !!proc };
