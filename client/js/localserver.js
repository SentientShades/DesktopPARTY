const http = require('http');
const { WebSocketServer } = require('ws');

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

module.exports = { start, stop, isrunning: () => !!server };
