const net = require('net');
const os = require('os');

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
    console.log('[discord] no client id set — rich presence disabled');
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

module.exports = { start, setactivity, clearactivity, stop };
