const WebSocket = require('ws');

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
  else sigqueue.push(msg);
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

module.exports = { connect, send, connectsignal, sendsignal, disconnect };
