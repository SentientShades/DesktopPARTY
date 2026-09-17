// ---- drawing on the desktop ----
(() => {
  const canvas = document.getElementById('draw-canvas');
  const ctx = canvas.getContext('2d');

  const toast  = document.getElementById('drawtoast');
  const grip   = document.getElementById('drawgrip');
  const shut   = document.getElementById('drawclose');
  const swatch = document.getElementById('drawswatch');
  const hue    = document.getElementById('drawhue');
  const light  = document.getElementById('drawlight');
  const size   = document.getElementById('drawsize');
  const sizeval = document.getElementById('drawsizeval');
  const eraser = document.getElementById('draweraser');
  const wipe   = document.getElementById('drawclear');
  const hint   = document.getElementById('drawhint');

  const erasew = 28;
  const batchms = 40;

  let tool = null;
  let brush = 4;
  let drawing = false;
  let open = false;
  let last = null;
  const pending = [];
  let flushtimer = null;

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  window.addEventListener('resize', () => {
    let snap = null;
    try { snap = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch {}
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    if (snap) { try { ctx.putImageData(snap, 0, 0); } catch {} }
  });

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

  function refresh() {
    const h = Number(hue.value);
    const l = Number(light.value) / 100;
    const hex = tohex(h, 0.85, l);

    swatch.style.setProperty('--sw', hex);
    swatch.dataset.color = hex;
    hue.style.setProperty('--thumb', hex);
    light.style.setProperty('--thumb', hex);
    light.style.background =
      `linear-gradient(to right, #000000, ${tohex(h, .85, .5)}, #ffffff)`;

    return hex;
  }

  [hue, light].forEach(el => {
    el.addEventListener('input', () => {
      const hex = refresh();
      if (tool && tool !== 'erase') settool(hex);
    });
  });

  size.addEventListener('input', () => {
    brush = Number(size.value);
    sizeval.textContent = brush;
  });

  [hue, light, size].forEach(el => {
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
  });

  function stroke(x1, y1, x2, y2, color, width) {
    ctx.save();
    if (color === null) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
    }
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1 * canvas.width, y1 * canvas.height);
    ctx.lineTo(x2 * canvas.width, y2 * canvas.height);
    ctx.stroke();
    ctx.restore();
  }

  function flush() {
    flushtimer = null;
    if (!pending.length) return;
    window.party?.broadcast({ t: 'd', segs: pending.splice(0) });
  }

  function queue(seg) {
    pending.push(seg);
    if (!flushtimer) flushtimer = setTimeout(flush, batchms);
  }

  const norm = (e) => ({
    x: e.clientX / window.innerWidth,
    y: e.clientY / window.innerHeight
  });

  const color = () => (tool === 'erase' ? null : tool);
  const width = () => (tool === 'erase' ? erasew : brush);

  canvas.addEventListener('pointerdown', (e) => {
    if (!tool) return;
    drawing = true;
    last = norm(e);
    try { canvas.setPointerCapture(e.pointerId); } catch {}

    const c = color(), w = width();
    stroke(last.x, last.y, last.x, last.y, c, w);
    queue([last.x, last.y, last.x, last.y, c, w]);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing || !tool) return;
    const p = norm(e);
    const c = color(), w = width();
    stroke(last.x, last.y, p.x, p.y, c, w);
    queue([last.x, last.y, p.x, p.y, c, w]);
    last = p;
  });

  const endstroke = () => {
    if (!drawing) return;
    drawing = false;
    last = null;
    flush();
    window.physics?.rebuildink?.();
  };
  canvas.addEventListener('pointerup', endstroke);
  canvas.addEventListener('pointercancel', endstroke);
  canvas.addEventListener('pointerleave', endstroke);

  function settool(next) {
    tool = next;
    window.drawmode = !!next;

    swatch.classList.toggle('active', !!next && next !== 'erase');
    eraser.classList.toggle('active', next === 'erase');

    canvas.classList.toggle('armed', !!next);
    window.overlay.drawmode(!!next);

    hint.textContent = next
      ? 'Drawing, press Esc to stop'
      : 'Pick the pen to draw anywhere on screen';

    window.overlay.setstate?.(next ? 'Drawing on the desktop' : '');
  }

  swatch.addEventListener('click', (e) => {
    e.stopPropagation();
    const hex = refresh();
    settool(tool && tool !== 'erase' ? null : hex);
  });

  eraser.addEventListener('click', (e) => {
    e.stopPropagation();
    settool(tool === 'erase' ? null : 'erase');
  });

  wipe.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    window.party?.broadcast({ t: 'dclear' });
    window.physics?.rebuildink?.();
  });

  let held = false;
  let grab = { x: 0, y: 0 };

  function place(x, y) {
    const maxx = window.innerWidth - toast.offsetWidth;
    const maxy = window.innerHeight - toast.offsetHeight;
    toast.style.transform =
      `translate(${Math.max(0, Math.min(maxx, x))}px, ${Math.max(0, Math.min(maxy, y))}px)`;
  }

  grip.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.draw-x')) return;
    const box = toast.getBoundingClientRect();
    held = true;
    window.dragging = true;
    grab = { x: e.clientX - box.left, y: e.clientY - box.top };
    try { grip.setPointerCapture(e.pointerId); } catch {}
  });

  grip.addEventListener('pointermove', (e) => {
    if (!held) return;
    place(e.clientX - grab.x, e.clientY - grab.y);
  });

  const release = () => { held = false; window.dragging = false; };
  grip.addEventListener('pointerup', release);
  grip.addEventListener('pointercancel', release);

  shut.addEventListener('click', (e) => {
    e.stopPropagation();
    setvisible(false);
  });

  function setvisible(next) {
    open = next;
    toast.classList.toggle('hidden', !next);
    if (!next && tool) settool(null);
    if (next && !toast.style.transform) {
      place(window.innerWidth / 2 - 160, window.innerHeight / 2 - 120);
    }
  }

  refresh();
  sizeval.textContent = brush;

  window.draw = {
    apply(msg) {
      if (msg.t === 'dclear') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        window.physics?.rebuildink?.();
        return;
      }
      (msg.segs || []).forEach(([x1, y1, x2, y2, c, w]) => {
        stroke(x1, y1, x2, y2, c, w);
      });
      window.physics?.rebuildink?.();
    },
    clearcanvas() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      window.physics?.rebuildink?.();
    },
    isink(px, py) {
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return false;
      try {
        return ctx.getImageData(px, py, 1, 1).data[3] > 10;
      } catch { return false; }
    },
    setvisible,
    toggle() { setvisible(!open); },
    isopen: () => open,

    snapshot() {
      try { return canvas.toDataURL('image/png'); }
      catch { return null; }
    },

    wipe() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      window.physics?.rebuildink?.();
    },

    restore(data) {
      if (!data) return;
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        window.physics?.rebuildink?.();
      };
      img.src = data;
    },

    isarmed: () => !!tool,
    disarm() { if (tool) settool(null); }
  };
})();

// ---- shared browser ----
(() => {
  const cardw = 760;
  const cardh = 520;
  const movems = 33;

  let card = null;
  let view = null;
  let held = false;
  let grab = { x: 0, y: 0 };
  let remotenav = false;
  let sent = 0;

  function where() {
    const r = card.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }

  function place(x, y) {
    x = Math.max(0, Math.min(window.innerWidth - 60, x));
    y = Math.max(0, Math.min(window.innerHeight - 40, y));
    card.style.transform = `translate(${x}px, ${y}px)`;
  }

  function normalize(raw) {
    const u = raw.trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[\w-]+(\.[\w-]+)+([\/?#].*)?$/.test(u)) return `https://${u}`;
    return `https://www.google.com/search?q=${encodeURIComponent(u)}`;
  }

  async function build(url, x, y) {
    const preload = await window.overlay.getwebviewpreloadpath();

    card = document.createElement('div');
    card.className = 'browser-card interactive';
    card.style.width = cardw + 'px';
    card.style.height = cardh + 'px';

    const bar = document.createElement('div');
    bar.className = 'browser-bar';

    const grip = document.createElement('div');
    grip.className = 'browser-drag';
    grip.textContent = '⠿';

    const addr = document.createElement('input');
    addr.type = 'text';
    addr.className = 'browser-addr';
    addr.value = url;
    addr.spellcheck = false;

    const go = document.createElement('button');
    go.className = 'browser-go mini';
    go.textContent = 'Go';

    const hide = document.createElement('button');
    hide.className = 'browser-hide mini ghost';
    hide.textContent = '–';
    hide.title = 'Hide for me';

    const shut = document.createElement('button');
    shut.className = 'browser-close mini ghost';
    shut.textContent = '✕';
    shut.title = 'End for everyone';

    bar.append(grip, addr, go, hide, shut);

    view = document.createElement('webview');
    view.className = 'browser-view';
    view.setAttribute('src', url);
    view.setAttribute('preload', preload);
    view.setAttribute('allowpopups', 'false');
    view.setAttribute('partition', 'persist:sharedbrowser');

    card.append(bar, view);
    document.body.appendChild(card);
    place(x, y);

    function navigate(raw) {
      view.loadURL(normalize(raw)).catch(() => {});
    }

    go.addEventListener('click', () => navigate(addr.value));
    addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(addr.value); });
    addr.addEventListener('pointerdown', (e) => e.stopPropagation());
    go.addEventListener('pointerdown', (e) => e.stopPropagation());

    const moved = (e) => {
      addr.value = e.url;
      if (!remotenav) {
        window.party.broadcast({ t: 'bwnav', url: e.url });
      }
    };
    view.addEventListener('did-navigate', moved);
    view.addEventListener('did-navigate-in-page', moved);

    view.addEventListener('ipc-message', (e) => {
      if (e.channel === 'bw:scroll') {
        window.party.broadcast({ t: 'bwscroll', x: e.args[0].x, y: e.args[0].y });
      } else if (e.channel === 'bw:selection') {
        window.party.broadcast({ t: 'bwsel', sel: e.args[0] });
      } else if (e.channel === 'bw:video') {
        window.party.broadcast({ t: 'bwvideo', action: e.args[0].action, at: e.args[0].at });
      }
    });

    grip.addEventListener('pointerdown', (e) => {
      held = true;
      window.dragging = true;
      const pos = where();
      grab = { x: e.clientX - pos.x, y: e.clientY - pos.y };
      try { grip.setPointerCapture(e.pointerId); } catch {}
    });
    grip.addEventListener('pointermove', (e) => {
      if (!held) return;
      const x = e.clientX - grab.x;
      const y = e.clientY - grab.y;
      place(x, y);
      const now = performance.now();
      if (now - sent > movems) {
        sent = now;
        window.party.broadcast({ t: 'bwmove', x: x / window.innerWidth, y: y / window.innerHeight });
      }
    });
    const letgo = () => {
      if (!held) return;
      held = false;
      window.dragging = false;
      const pos = where();
      window.party.broadcast({ t: 'bwmove', x: pos.x / window.innerWidth, y: pos.y / window.innerHeight });
    };
    grip.addEventListener('pointerup', letgo);
    grip.addEventListener('pointercancel', letgo);

    hide.addEventListener('click', () => destroy());
    shut.addEventListener('click', () => {
      window.party.broadcast({ t: 'bwclose' });
      destroy();
    });
  }

  function destroy() {
    if (card) { card.remove(); card = null; view = null; }
    window.overlay.setstate?.('');
  }

  async function open(url, x, y) {
    if (card) return;
    await build(url, x, y);
    window.overlay.setstate?.('Browsing together');
  }

  async function toggle() {
    if (card) { destroy(); return; }
    const x = window.innerWidth / 2 - cardw / 2;
    const y = window.innerHeight / 2 - cardh / 2;
    await open('https://www.google.com', x, y);
    window.party.broadcast({
      t: 'bwopen',
      url: 'https://www.google.com',
      x: x / window.innerWidth, y: y / window.innerHeight
    });
  }

  window.party?.onmessage(async (from, m) => {
    if (m.t === 'bwopen') {
      if (!card) {
        await open(m.url, m.x * window.innerWidth, m.y * window.innerHeight);
        window.party.sendto(from, { t: 'bwvideoask' });
      }
    }
    else if (m.t === 'bwclose') {
      destroy();
    }
    else if (m.t === 'bwmove') {
      if (card && !held) place(m.x * window.innerWidth, m.y * window.innerHeight);
    }
    else if (m.t === 'bwnav') {
      if (view) {
        remotenav = true;
        view.loadURL(m.url).catch(() => {});
        setTimeout(() => { remotenav = false; }, 300);
      }
    }
    else if (m.t === 'bwscroll') {
      view?.send('bw:apply-scroll', { x: m.x, y: m.y });
    }
    else if (m.t === 'bwsel') {
      view?.send('bw:apply-selection', m.sel);
    }
    else if (m.t === 'bwvideo') {
      view?.send('bw:apply-video', { action: m.action, at: m.at });
    }
    else if (m.t === 'bwvideoask') {
      view?.send('bw:request-video-state');
    }
  });

  window.overlay.onroster(({ members }) => {
    if (!members || members.length === 0) destroy();
  });

  window.browser = {
    toggle,
    isopen: () => !!card,
    onpeer(id) {
      if (!card || !view) return;
      const pos = where();
      window.party.sendto(id, {
        t: 'bwopen',
        url: view.getURL() || 'https://www.google.com',
        x: pos.x / window.innerWidth,
        y: pos.y / window.innerHeight
      });
    }
  };
})();

// ---- party votes ----
(() => {
  const windowms = 20000;
  const tickms = 250;

  let live = null;
  let seq = 0;

  const handlers = new Map();

  const stack = document.getElementById('toast-stack');

  function lobby() {
    return (window.party?.peers?.size || 0) + 1;
  }

  function needed(total) {
    return Math.ceil(total / 2);
  }

  function uid() {
    return `${window.party?.myid?.() || 'x'}-v${Date.now().toString(36)}-${(seq++).toString(36)}`;
  }

  function card(label, from, endsat, onpick) {
    const el = document.createElement('div');
    el.className = 'toast vote-toast interactive entering';
    el.dataset.status = 'idle';

    const body = document.createElement('div');
    body.className = 'toast-body';

    const name = document.createElement('span');
    name.className = 'toast-name';
    name.textContent = from;

    const sub = document.createElement('span');
    sub.className = 'toast-sub';
    sub.textContent = label;

    body.append(name, sub);

    const bar = document.createElement('div');
    bar.className = 'vote-bar';
    const fill = document.createElement('div');
    fill.className = 'vote-fill';
    bar.appendChild(fill);

    const row = document.createElement('div');
    row.className = 'vote-row';

    const yes = document.createElement('button');
    yes.className = 'mini vote-yes';
    yes.textContent = 'Accept';

    const no = document.createElement('button');
    no.className = 'mini ghost vote-no';
    no.textContent = 'Decline';

    row.append(no, yes);
    el.append(body, bar, row);
    stack.appendChild(el);

    void el.offsetWidth;
    el.classList.remove('entering');

    let done = false;
    const finish = (choice) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      el.style.height = `${el.offsetHeight}px`;
      void el.offsetWidth;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 240);
      onpick(choice);
    };

    yes.addEventListener('click', () => finish(true));
    no.addEventListener('click', () => finish(false));

    const total = endsat - Date.now();
    const timer = setInterval(() => {
      const left = endsat - Date.now();
      fill.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
      if (left <= 0) finish(null);
    }, tickms);

    return { close: () => finish(null) };
  }

  function labelfor(kind, payload) {
    if (kind === 'theater') return 'wants to start Theater';
    return `wants to start ${payload?.name || kind}`;
  }

  function tally() {
    if (!live || !live.owner) return;

    const total = live.total;
    const want = needed(total);
    const yes = live.yes.size;
    const no = live.no.size;

    if (yes >= want) return settle(true);
    if (total - no < want) return settle(false);
    if (Date.now() >= live.endsat) return settle(yes >= want);
  }

  function settle(passed) {
    if (!live || live.settled) return;
    live.settled = true;
    clearInterval(live.timer);

    window.party?.broadcast({ t: 'voteend', id: live.id, passed });

    const { kind, payload, id } = live;
    live.card?.close();
    live = null;

    if (passed) handlers.get(kind)?.(payload, id, window.party.myid());
    else window.toasts?.show({
      name: 'Vote failed',
      activity: 'Not enough of the party accepted',
      status: 'offline',
      duration: 4000,
      noavatar: true
    });
  }

  function start(kind, payload) {
    if (live) return false;

    const total = lobby();
    const id = uid();

    if (total <= 1) {
      handlers.get(kind)?.(payload, id, window.party.myid());
      return true;
    }

    const endsat = Date.now() + windowms;

    live = {
      id, kind, payload, owner: true, total, endsat,
      yes: new Set([window.party.myid()]),
      no: new Set(),
      settled: false,
      card: null,
      timer: setInterval(tally, tickms)
    };

    window.party.broadcast({ t: 'votestart', id, kind, payload, endsat });

    window.toasts?.show({
      name: 'Waiting on the party',
      activity: labelfor(kind, payload).replace('wants to', 'You want to'),
      status: 'idle',
      duration: 3000,
      noavatar: true
    });

    tally();
    return true;
  }

  function on(kind, fn) {
    handlers.set(kind, fn);
  }

  window.party?.onmessage((from, m) => {
    if (m.t === 'votestart') {
      if (live) {
        window.party.sendto(from, { t: 'votecast', id: m.id, yes: false });
        return;
      }

      live = { id: m.id, kind: m.kind, payload: m.payload, from, owner: false, settled: false };

      live.card = card(
        labelfor(m.kind, m.payload),
        window.party.infofor(from).name,
        m.endsat,
        (choice) => {
          if (choice === null) return;
          window.party.sendto(from, { t: 'votecast', id: m.id, yes: choice });
        }
      );
    }
    else if (m.t === 'votecast') {
      if (!live || !live.owner || live.id !== m.id) return;
      live.yes.delete(from);
      live.no.delete(from);
      (m.yes ? live.yes : live.no).add(from);
      tally();
    }
    else if (m.t === 'voteend') {
      if (!live || live.owner || live.id !== m.id) return;
      const { kind, payload, id, from: owner } = live;
      live.card?.close();
      live = null;
      if (m.passed) handlers.get(kind)?.(payload, id, owner);
    }
  });

  window.overlay.onroster(({ members }) => {
    if (!live || !live.owner) return;
    const set = new Set(members || []);
    live.yes.forEach(id => { if (!set.has(id)) live.yes.delete(id); });
    live.no.forEach(id => { if (!set.has(id)) live.no.delete(id); });
    live.total = lobby();
    tally();
  });

  window.vote = { start, on, lobby, needed, isopen: () => !!live };
})();

// ---- stage capture + streaming ----
(() => {
  let stage = null;
  let capture = null;
  let mode = 'none';

  async function broadcaststart(url) {
    const info = await window.overlay.stageopen(url);
    if (!info?.sourceid) throw new Error('Could not open the stage window');
    stage = info;

    const video = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: info.sourceid,
        maxWidth: 1280,
        maxHeight: 720,
        maxFrameRate: 30
      }
    };

    try {
      capture = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          sampleRate: 48000,
          sampleSize: 16,
          latency: 0
        }
      });

      capture.getAudioTracks().forEach(t => {
        t.applyConstraints({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2
        }).catch(() => {});
      });
      mode = capture.getAudioTracks().length ? 'frame' : 'framevideo';
      window.debuglog?.('out', 'capture', `stage frame (${mode}), Discord excluded`);
    } catch (frameerr) {
      window.debuglog?.('out', 'capture', `frame capture failed (${frameerr.name}), falling back`);
      try {
        capture = await navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: 'desktop' } },
          video
        });
        mode = 'system';
        window.debuglog?.('out', 'capture', 'system audio, everything is shared');
      } catch (e) {
        window.debuglog?.('out', 'capture', `audio failed (${e.name}), video only`);
        capture = await navigator.mediaDevices.getUserMedia({ audio: false, video });
        mode = 'silent';
      }
    }

    window.party.addstream(capture);
    return capture;
  }

  function broadcaststop() {
    if (capture) {
      window.party.dropstream(capture);
      capture.getTracks().forEach(t => t.stop());
      capture = null;
      mode = 'none';
    }
    if (stage) {
      window.overlay.stageclose();
      stage = null;
    }
  }

  function stagego(url) {
    return window.overlay.stagego(url);
  }

  function stagesize() {
    return stage ? { w: stage.width, h: stage.height } : null;
  }

  function audiomode() { return mode; }

  window.media = {
    stagesize,
    audiomode,
    broadcaststart,
    broadcaststop,
    stagego,
    iscapturing: () => !!capture
  };
})();

// ---- theater room ----
(() => {
  const closems = 900;
  const holdms = 1000;
  const partms = 1100;
  const syncms = 60;

  let root = null;
  let curtains = null;
  let screen = null;
  let video = null;
  let stagewrap = null;
  let seatrow = null;
  let statusline = null;
  let bar = null;
  let ask = null;

  let open = false;
  let presenter = null;
  let saved = null;
  let driving = null;
  let hunt = null;

  const figures = new Map();
  const tiers = [];
  let dragging = null;
  let lastsync = 0;
  let glowtimer = null;
  let sampler = null;
  let bartimer = null;
  let closing = false;

  const me = () => window.party?.myid?.();
  const presenting = () => presenter === me() && window.media.iscapturing();
  const note = (t) => window.debuglog?.('out', 'theater', t);

  function buildcurtains() {
    curtains = document.createElement('div');
    curtains.id = 'curtains';
    curtains.innerHTML =
      '<div class="curtain curtainleft"></div>' +
      '<div class="curtain curtainright"></div>';
    document.body.appendChild(curtains);
  }

  function buildroot() {
    root = document.createElement('div');
    root.id = 'theater';
    root.className = 'interactive';

    const room = document.createElement('div');
    room.className = 'th-room';

    const drapeleft = document.createElement('div');
    drapeleft.className = 'th-drape th-drapeleft';
    const draperight = document.createElement('div');
    draperight.className = 'th-drape th-draperight';

    stagewrap = document.createElement('div');
    stagewrap.className = 'th-stage';

    screen = document.createElement('div');
    screen.className = 'th-screen';

    video = document.createElement('video');
    video.className = 'th-video hidden';
    video.playsInline = true;
    video.autoplay = true;

    const idle = document.createElement('div');
    idle.className = 'th-idle';
    idle.id = 'theateridle';
    idle.textContent = 'Nothing playing';

    bar = document.createElement('div');
    bar.className = 'th-bar';

    screen.append(video, idle, bar);

    const wake = () => {
      screen.classList.add('showbar');
      clearTimeout(bartimer);
      bartimer = setTimeout(() => screen.classList.remove('showbar'), 3000);
    };

    screen.addEventListener('pointermove', wake);
    screen.addEventListener('pointerdown', wake);
    bar.addEventListener('pointermove', (e) => { e.stopPropagation(); wake(); });
    screen.addEventListener('pointerleave', () => {
      clearTimeout(bartimer);
      bartimer = setTimeout(() => screen.classList.remove('showbar'), 400);
    });
    stagewrap.appendChild(screen);

    statusline = document.createElement('div');
    statusline.className = 'th-status';

    ask = document.createElement('div');
    ask.className = 'th-ask hidden';

    const house = document.createElement('div');
    house.className = 'th-house';

    tiers.length = 0;

    [
      { name: 'back',  count: 4 },
      { name: 'front', count: 4 }
    ].forEach((spec, index) => {
      const tier = document.createElement('div');
      tier.className = `th-tier th-tier${spec.name}`;

      const figs = document.createElement('div');
      figs.className = 'th-figs';

      const seats = document.createElement('div');
      seats.className = 'th-seats';

      const chairs = [];
      for (let i = 0; i < spec.count; i++) {
        const chair = document.createElement('div');
        chair.className = 'th-chair';
        seats.appendChild(chair);
        chairs.push(chair);
      }

      tier.append(figs, seats);
      house.appendChild(tier);
      tiers.push({ row: index, figs, seats, chairs });
    });

    seatrow = tiers[1].figs;

    room.append(drapeleft, draperight, stagewrap, statusline, ask, house);
    root.appendChild(room);
    document.body.appendChild(root);
  }

  function askurl() {
    return new Promise(resolve => {
      ask.innerHTML = '';
      ask.classList.remove('hidden');

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'th-input';
      input.placeholder = 'Paste a link to put it on the screen';
      input.spellcheck = false;

      const go = document.createElement('button');
      go.className = 'mini';
      go.textContent = 'Play';

      const cancel = document.createElement('button');
      cancel.className = 'mini ghost';
      cancel.textContent = 'Cancel';

      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        ask.classList.add('hidden');
        ask.innerHTML = '';
        resolve(v);
      };

      go.addEventListener('click', () => finish(input.value.trim() || null));
      cancel.addEventListener('click', () => finish(null));
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(input.value.trim() || null);
        if (e.key === 'Escape') finish(null);
      });

      ask.append(input, go, cancel);
      input.focus();
    });
  }

  const icons = {
    back: '<path d="M11 4 4 10l7 6z"/><path d="M17 4l-7 6 7 6z"/>',
    playpause: '<path d="M4 3l9 7-9 7z"/>',
    forward: '<path d="M9 4l7 6-7 6z"/><path d="M3 4l7 6-7 6z"/>',
    mute: '<path d="M4 8h3l4-3v10l-4-3H4z"/><path d="M13 7l4 6M17 7l-4 6" stroke="currentColor" stroke-width="1.6" fill="none"/>',
    full: '<path d="M3 3h6v2H5v4H3z"/><path d="M17 3h-6v2h4v4h2z"/><path d="M3 17h6v-2H5v-4H3z"/><path d="M17 17h-6v-2h4v-4h2z"/>',
    link: '<path d="M8 12a4 4 0 0 1 0-5l2-2a4 4 0 0 1 6 6l-1 1" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 8a4 4 0 0 1 0 5l-2 2a4 4 0 0 1-6-6l1-1" stroke="currentColor" stroke-width="1.7" fill="none"/>',
    bug: '<path d="M7 6a3 3 0 0 1 6 0z"/><rect x="6" y="7" width="8" height="9" rx="4"/><path d="M4 9h2M14 9h2M4 13h2M14 13h2" stroke="currentColor" stroke-width="1.4"/>',
    close: '<path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  };

  function iconbutton(label, name, fn) {
    const b = document.createElement('button');
    b.className = 'th-btn';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor">${icons[name]}</svg>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  }

  function buildbar() {
    bar.innerHTML = '';

    bar.append(
      iconbutton('Back 5s', 'back', () => sendkey('ArrowLeft')),
      iconbutton('Play / pause', 'playpause', () => sendkey(' ')),
      iconbutton('Forward 5s', 'forward', () => sendkey('ArrowRight')),
      iconbutton('Mute', 'mute', () => sendkey('m')),
      iconbutton('Fullscreen', 'full', () => sendkey('f'))
    );

    const spacer = document.createElement('div');
    spacer.className = 'th-spacer';
    bar.appendChild(spacer);

    bar.append(
      iconbutton('Put something on', 'link', picklink),
      iconbutton('Debug', 'bug', () => window.debugpanel?.toggle()),
      iconbutton('Close for everyone', 'close', () => close(true))
    );
  }

  function sendkey(key) {
    const ev = { kind: 'key', key };
    if (presenting()) applylocal(ev);
    else if (presenter) window.party.sendto(presenter, { t: 'stagectrl', ev });
  }

  function applylocal(ev) {
    if (!window.media.iscapturing()) return;
    const size = window.media.stagesize();
    if (!size) return;

    if (ev.kind === 'key') {
      window.overlay.stageinput({ type: 'keyDown', keyCode: ev.key, modifiers: ev.mods || [] });
      if (ev.key.length === 1) {
        window.overlay.stageinput({ type: 'char', keyCode: ev.key, modifiers: ev.mods || [] });
      }
      window.overlay.stageinput({ type: 'keyUp', keyCode: ev.key, modifiers: ev.mods || [] });
      return;
    }

    const x = Math.round(ev.nx * size.w);
    const y = Math.round(ev.ny * size.h);

    if (ev.kind === 'move') {
      window.overlay.stageinput({ type: 'mouseMove', x, y, modifiers: ev.mods || [] });
    } else if (ev.kind === 'down' || ev.kind === 'up') {
      window.overlay.stageinput({
        type: ev.kind === 'down' ? 'mouseDown' : 'mouseUp',
        x, y, button: ev.button || 'left', clickCount: ev.clicks || 1,
        modifiers: ev.mods || []
      });
    } else if (ev.kind === 'wheel') {
      window.overlay.stageinput({
        type: 'mouseWheel', x, y,
        deltaX: ev.dx, deltaY: ev.dy, canScroll: true, modifiers: ev.mods || []
      });
    }
  }

  function route(ev) {
    if (presenting()) applylocal(ev);
    else if (presenter) window.party.sendto(presenter, { t: 'stagectrl', ev });
  }

  function mods(e) {
    const out = [];
    if (e.shiftKey) out.push('shift');
    if (e.ctrlKey)  out.push('control');
    if (e.altKey)   out.push('alt');
    return out;
  }

  function norm(e) {
    if (!video.videoWidth) return null;
    const rect = video.getBoundingClientRect();
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    const nx = (e.clientX - rect.left - (rect.width - w) / 2) / w;
    const ny = (e.clientY - rect.top - (rect.height - h) / 2) / h;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
    return { nx, ny };
  }

  const buttons = ['left', 'middle', 'right'];

  function drive() {
    if (driving) return;
    screen.classList.add('th-live');
    let last = 0;

    const move = (e) => {
      const now = performance.now();
      if (now - last < 20) return;
      last = now;
      const p = norm(e);
      if (p) route({ kind: 'move', ...p, mods: mods(e) });
    };
    const down = (e) => {
      const p = norm(e);
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      route({ kind: 'down', ...p, button: buttons[e.button] || 'left', clicks: e.detail || 1, mods: mods(e) });
    };
    const up = (e) => {
      const p = norm(e);
      if (!p) return;
      e.preventDefault();
      route({ kind: 'up', ...p, button: buttons[e.button] || 'left', clicks: e.detail || 1, mods: mods(e) });
    };
    const wheel = (e) => {
      const p = norm(e);
      if (!p) return;
      e.preventDefault();
      route({ kind: 'wheel', ...p, dx: -e.deltaX, dy: -e.deltaY, mods: mods(e) });
    };
    const menu = (e) => e.preventDefault();
    const key = (e) => {
      if (!ask.classList.contains('hidden')) return;
      if (e.key === 'Escape' || e.key === 'F9') return;
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      e.stopPropagation();
      route({ kind: 'key', key: e.key, mods: mods(e) });
    };

    video.addEventListener('pointermove', move);
    video.addEventListener('pointerdown', down);
    video.addEventListener('pointerup', up);
    video.addEventListener('wheel', wheel, { passive: false });
    video.addEventListener('contextmenu', menu);
    window.addEventListener('keydown', key, true);

    driving = () => {
      screen?.classList.remove('th-live');
      video.removeEventListener('pointermove', move);
      video.removeEventListener('pointerdown', down);
      video.removeEventListener('pointerup', up);
      video.removeEventListener('wheel', wheel);
      video.removeEventListener('contextmenu', menu);
      window.removeEventListener('keydown', key, true);
      driving = null;
    };
  }

  function lowlatency(stream) {
    try {
      window.party.peers.forEach(e => {
        e.pc.getReceivers().forEach(r => {
          if (r.track && stream.getTracks().includes(r.track)) {
            try { r.playoutDelayHint = 0; } catch {}
            try { r.jitterBufferTarget = 0; } catch {}
          }
        });
      });
    } catch {}
  }

  function startglow() {
    clearInterval(glowtimer);
    sampler = sampler || document.createElement('canvas');
    sampler.width = 8;
    sampler.height = 5;
    const ctx = sampler.getContext('2d', { willReadFrequently: true });

    glowtimer = setInterval(() => {
      if (!video || !video.videoWidth || video.paused) return;
      try {
        ctx.drawImage(video, 0, 0, 8, 5);
        const px = ctx.getImageData(0, 0, 8, 5).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
        const n = px.length / 4;
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        const boost = (v) => Math.min(255, Math.round(v * 1.5 + 12));
        root?.style.setProperty('--glow', `rgb(${boost(r)}, ${boost(g)}, ${boost(b)})`);
      } catch {}
    }, 180);
  }

  function setidle(text) {
    const idle = document.getElementById('theateridle');
    if (!idle) return;
    idle.textContent = text || '';
    idle.classList.toggle('hidden', !text);
  }

  function play() {
    const attempt = video.play();
    if (!attempt?.catch) return;
    attempt.catch((e) => {
      note(`play rejected: ${e.name}`);
      if (e.name === 'NotAllowedError') {
        setidle('Click the screen to start');
        screen.addEventListener('click', () => { setidle(''); video.play().catch(() => {}); }, { once: true });
      } else setidle(`Playback failed: ${e.message}`);
    });
  }

  async function picklink() {
    const raw = await askurl();
    if (!raw) return;

    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setidle('Starting…');
    note(`sharing ${url}`);

    try {
      if (window.media.iscapturing()) {
        await window.media.stagego(url);
      } else {
        const stream = await window.media.broadcaststart(url);
        const mode = window.media.audiomode();
        note(`capture up mode=${mode}`);
        video.srcObject = stream;
        video.muted = mode !== 'frame';
        video.classList.remove('hidden');
        startglow();
        play();
      }

      presenter = me();
      drive();
      window.party.broadcast({ t: 'theatermedia', url });
      setidle('');
    } catch (e) {
      note(`share failed: ${e.message}`);
      setidle(`Stream failed: ${e.message}`);
    }
  }

  function attachstream() {
    if (!open || !presenter || presenting()) return false;
    const stream = window.party.streamfor(presenter);
    if (!stream) return false;
    const track = stream.getVideoTracks()[0];
    if (!track) return false;
    if (video.srcObject === stream) return true;

    note(`attaching ${stream.id.slice(0, 8)} muted=${track.muted}`);
    video.srcObject = stream;
    video.muted = false;
    video.classList.remove('hidden');
    lowlatency(stream);
    startglow();
    setidle(track.muted ? 'Waiting for frames…' : '');
    play();
    drive();

    track.addEventListener('unmute', () => { setidle(''); play(); });
    return true;
  }

  function starthunt() {
    clearInterval(hunt);
    let n = 0;
    hunt = setInterval(() => {
      n++;
      if (attachstream() || n > 40) { clearInterval(hunt); hunt = null; }
    }, 500);
  }

  function seatcentre(row, seat, fig) {
    const tier = tiers[row];
    if (!tier) return { x: 0, y: 0 };
    const chair = tier.chairs[Math.max(0, Math.min(tier.chairs.length - 1, seat))];
    if (!chair) return { x: 0, y: 0 };

    const box = chair.getBoundingClientRect();
    const base = tier.figs.getBoundingClientRect();
    const tall = fig ? fig.wrap.offsetHeight : 0;

    return {
      x: box.left - base.left + box.width / 2,
      y: box.top - base.top + box.height * 0.42 - tall
    };
  }

  function taken(row, seat, skip) {
    for (const f of figures.values()) {
      if (f.id === skip) continue;
      if (f.row === row && f.seat === seat) return true;
    }
    return false;
  }

  function freeseat(row, seat, skip) {
    const count = tiers[row]?.chairs.length || 1;
    if (!taken(row, seat, skip)) return seat;
    for (let d = 1; d < count; d++) {
      if (seat - d >= 0 && !taken(row, seat - d, skip)) return seat - d;
      if (seat + d < count && !taken(row, seat + d, skip)) return seat + d;
    }
    return seat;
  }

  function nearest(fig, clientx, clienty) {
    let best = { row: fig.row, seat: fig.seat, dist: Infinity };

    tiers.forEach((tier, row) => {
      const base = tier.figs.getBoundingClientRect();
      tier.chairs.forEach((chair, seat) => {
        const box = chair.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height * 0.42;
        const dist = Math.hypot(clientx - cx, (clienty - cy) * 0.7);
        if (dist < best.dist) best = { row, seat, dist, base };
      });
    });

    return best;
  }

  function place(fig, row, seat) {
    if (fig.row !== row && tiers[row]) {
      tiers[row].figs.appendChild(fig.wrap);
    }
    fig.row = row;
    fig.seat = seat;
    const spot = seatcentre(row, seat, fig);
    fig.tx = spot.x;
    fig.ty = spot.y;
  }

  function makefigure(id, row, seat) {
    const wrap = document.createElement('div');
    wrap.className = 'th-fig';

    const tag = document.createElement('span');
    tag.className = 'th-tag';
    tag.textContent = window.party.infofor(id).name;

    const body = document.createElement('div');
    body.className = 'th-body';

    const head = document.createElement('div');
    head.className = 'th-head';
    const info = window.party.infofor(id);
    if (info.avatar) head.style.backgroundImage = `url('${info.avatar}')`;

    const torso = document.createElement('div');
    torso.className = 'th-torso';

    body.append(head, torso);
    wrap.append(tag, body);
    (tiers[row] || tiers[0]).figs.appendChild(wrap);

    const fig = {
      id, wrap, body,
      row, seat,
      x: 0, y: 0, tx: 0, ty: 0,
      vx: 0, angle: 0, av: 0, held: false
    };

    figures.set(id, fig);
    place(fig, row, seat);
    fig.x = fig.tx;
    fig.y = fig.ty;
    binddrag(fig);
    return fig;
  }

  function binddrag(fig) {
    fig.body.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const base = tiers[fig.row].figs.getBoundingClientRect();
      dragging = {
        fig,
        gx: e.clientX - base.left - fig.x,
        gy: e.clientY - base.top - fig.y
      };
      fig.held = true;
      fig.wrap.classList.add('held');
      try { fig.body.setPointerCapture(e.pointerId); } catch {}
    });

    fig.body.addEventListener('pointermove', (e) => {
      if (!dragging || dragging.fig !== fig) return;
      const base = tiers[fig.row].figs.getBoundingClientRect();
      const nx = e.clientX - base.left - dragging.gx;
      const ny = e.clientY - base.top - dragging.gy;

      fig.vx = nx - fig.x;
      fig.av += fig.vx * 0.05;
      fig.x = nx;
      fig.y = ny;
      fig.tx = nx;
      fig.ty = ny;
    });

    const release = (e) => {
      if (!dragging || dragging.fig !== fig) return;
      fig.held = false;
      fig.wrap.classList.remove('held');
      dragging = null;

      const spot = nearest(fig, e.clientX ?? 0, e.clientY ?? 0);
      const seat = freeseat(spot.row, spot.seat, fig.id);
      place(fig, spot.row, seat);

      window.party.broadcast({ t: 'seatmove', who: fig.id, row: spot.row, seat });
    };

    fig.body.addEventListener('pointerup', release);
    fig.body.addEventListener('pointercancel', release);
  }

  function step() {
    if (!open) return;

    figures.forEach(fig => {
      if (!fig.held) {
        fig.vx = (fig.tx - fig.x) * 0.22;
        fig.x += fig.vx;
        fig.y += (fig.ty - fig.y) * 0.22;
        fig.av += fig.vx * 0.02;
      }

      fig.av += (0 - fig.angle) * 0.07;
      fig.av *= 0.86;
      fig.angle += fig.av;
      fig.angle = Math.max(-30, Math.min(30, fig.angle));

      fig.wrap.style.transform = `translate(${fig.x.toFixed(1)}px, ${fig.y.toFixed(1)}px)`;
      fig.body.style.transform = `rotate(${fig.angle.toFixed(2)}deg)`;
    });

    requestAnimationFrame(step);
  }

  function relayout() {
    figures.forEach(fig => {
      if (fig.held) return;
      place(fig, fig.row, fig.seat);
    });
  }

  function crowd() {
    if (!tiers.length) return;
    const ids = [me(), ...window.party.peers.keys()].filter(Boolean).sort();

    figures.forEach((fig, id) => {
      if (!ids.includes(id)) { fig.wrap.remove(); figures.delete(id); }
    });

    ids.slice(0, 8).forEach((id, index) => {
      if (figures.has(id)) return;
      const row = 1;
      const middle = Math.floor(tiers[row].chairs.length / 2);
      const wanted = middle + (index % 2 ? 1 : -1) * Math.ceil(index / 2);
      const seat = freeseat(row, Math.max(0, Math.min(tiers[row].chairs.length - 1, wanted)), id);
      makefigure(id, row, seat);
    });
  }

  function stash() {
    saved = {
      objects: window.physics?.snapshot?.() || [],
      players: window.players?.snapshot?.() || [],
      ink: window.draw?.snapshot?.() || null
    };
    window.physics?.wipe?.();
    window.players?.wipe?.();
    window.draw?.wipe?.();
  }

  function unstash() {
    if (!saved) return;
    window.physics?.restore?.(saved.objects);
    window.players?.restore?.(saved.players);
    window.draw?.restore?.(saved.ink);
    saved = null;
  }

  async function enter() {
    if (open) return;
    open = true;
    note('theater open');

    window.menu?.close();
    if (window.browser?.isopen?.()) window.browser.toggle();

    buildcurtains();
    void curtains.offsetWidth;
    curtains.classList.add('shut');

    await new Promise(r => setTimeout(r, closems + holdms));

    stash();
    buildroot();
    buildbar();
    crowd();

    window.overlay.menuactive(true);
    window.overlay.setstate?.('Watching something together');
    window.refreshignore?.();

    void root.offsetWidth;
    root.classList.add('lit');
    curtains.classList.add('open');

    setTimeout(() => { curtains?.remove(); curtains = null; }, partms);

    requestAnimationFrame(step);
    window.addEventListener('resize', relayout);
    setTimeout(relayout, 60);
    if (presenter) starthunt();
  }

  async function close(broadcast) {
    if (!open || closing) return;
    closing = true;

    if (broadcast) window.party?.broadcast({ t: 'theaterclose' });

    buildcurtains();
    void curtains.offsetWidth;
    curtains.classList.add('shut');
    await new Promise(r => setTimeout(r, closems + 250));

    open = false;

    clearTimeout(bartimer);
    clearInterval(hunt);
    hunt = null;
    clearInterval(glowtimer);
    glowtimer = null;
    undrive();

    if (window.media.iscapturing()) window.media.broadcaststop();

    video?.pause?.();
    if (video) { video.removeAttribute('src'); video.srcObject = null; }

    window.removeEventListener('resize', relayout);
    figures.forEach(f => f.wrap.remove());
    figures.clear();
    tiers.length = 0;
    dragging = null;

    root?.remove();
    root = null;
    presenter = null;

    unstash();

    window.overlay.menuactive(false);
    window.overlay.setstate?.('');
    window.refreshignore?.();

    curtains?.classList.add('open');
    const going = curtains;
    setTimeout(() => going?.remove(), partms);
    curtains = null;
    closing = false;
  }

  function undrive() { driving?.(); }

  window.party?.onstream((from) => {
    if (open && from === presenter) starthunt();
  });

  window.party?.onmessage((from, m) => {
    if (m.t === 'theateropen') enter();
    else if (m.t === 'theaterclose') close(false);
    else if (m.t === 'theatermedia') {
      if (window.media.iscapturing() && presenter === me()) {
        note(`${from} took over the screen`);
        window.media.broadcaststop();
        undrive();
      }
      presenter = from;
      setidle('Waiting for the stream…');
      starthunt();
    }
    else if (m.t === 'stagectrl') {
      if (presenting()) applylocal(m.ev);
    }
    else if (m.t === 'seatmove') {
      const fig = figures.get(m.who);
      if (!fig || fig.held) return;
      place(fig, m.row, m.seat);
    }
  });

  window.overlay.onroster(() => { if (open) crowd(); });

  window.vote?.on('theater', (payload, id, owner) => {
    if (open) return;
    if ((owner || me()) === me()) window.party?.broadcast({ t: 'theateropen' });
    enter();
  });

  window.theater = {
    request() {
      if (open) return;
      window.vote.start('theater', { name: 'Theater' });
    },
    close,
    isopen: () => open
  };
})();

// ---- right-click context menu ----
(() => {
  const root = document.createElement('div');
  root.id = 'menuroot';
  root.style.zIndex = '251';
  document.body.appendChild(root);

  const open = [];
  let target = null;

  function active() {
    return open.length > 0;
  }

  function flag(on) {
    window.menuopen = on;
    window.overlay?.menuactive?.(on);
    window.refreshignore?.();
  }

  function clear(depth) {
    while (open.length > depth) open.pop().remove();
  }

  function close() {
    clear(0);
    target = null;
    flag(false);
  }

  function place(el, x, y) {
    el.style.visibility = 'hidden';
    root.appendChild(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const px = Math.max(4, Math.min(window.innerWidth - w - 4, x));
    const py = Math.max(4, Math.min(window.innerHeight - h - 4, y));
    el.style.transform = `translate(${px}px, ${py}px)`;
    el.style.visibility = '';
    return { x: px, y: py, w, h };
  }

  function build(items, x, y, depth) {
    clear(depth);

    const el = document.createElement('div');
    el.className = 'menu interactive';

    items.forEach(item => {
      if (item.sep) {
        const line = document.createElement('div');
        line.className = 'menusep';
        el.appendChild(line);
        return;
      }

      const button = document.createElement('button');
      button.className = 'menuitem' + (item.danger ? ' danger' : '');

      const left = document.createElement('span');
      left.textContent = item.label;

      if (item.glyph) {
        const mark = document.createElement('span');
        mark.className = 'menuglyph';
        mark.textContent = item.glyph;
        button.appendChild(mark);
      }
      button.appendChild(left);

      if (item.children) {
        const arrow = document.createElement('span');
        arrow.className = 'menuarrow';
        arrow.textContent = '▸';
        button.appendChild(arrow);
      }

      button.addEventListener('pointerenter', () => {
        el.querySelectorAll('.menuitem.open').forEach(b => b.classList.remove('open'));
        if (!item.children) { clear(depth + 1); return; }
        button.classList.add('open');
        const box = button.getBoundingClientRect();
        build(item.children, box.right - 4, box.top - 5, depth + 1);
      });

      button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.children) return;
        item.run?.();
        close();
      });

      el.appendChild(button);
    });

    place(el, x, y);
    open[depth] = el;
    return el;
  }

  function worldmenu(x, y) {
    const shapes = [
      { label: 'Box', glyph: '■', shape: 'box' },
      { label: 'Ball', glyph: '●', shape: 'ball' },
      { label: 'Crate', glyph: '▬', shape: 'crate' },
      { label: 'Triangle', glyph: '▲', shape: 'triangle' }
    ].map(s => ({
      label: s.label,
      glyph: s.glyph,
      run: () => window.physics?.spawn(s.shape, x, y)
    }));

    shapes.push({ sep: true });
    shapes.push({ label: 'Clear mine', run: () => window.physics?.clearmine() });

    return [
      { label: 'Add', children: shapes },
      { label: 'Draw', run: () => window.draw?.toggle() },
      {
        label: 'Tabletop',
        children: [
          {
            label: 'Throw Dice',
            children: [
              { label: 'Roll 1', run: () => window.tabletop?.throwdice(x, y, 1) },
              { label: 'Roll 2', run: () => window.tabletop?.throwdice(x, y, 2) },
              { label: 'Roll 3', run: () => window.tabletop?.throwdice(x, y, 3) }
            ]
          },
          { label: '8 Ball', run: () => window.pool?.request() }
        ]
      },
      {
        label: 'Activities',
        children: [
          { label: 'Browser', run: () => window.browser?.toggle() },
          { label: 'Theater', run: () => window.theater?.request() }
        ]
      }
    ];
  }

  function objectmenu(o) {
    return [
      {
        label: o.frozen ? 'Unfreeze' : 'Freeze',
        run: () => window.physics?.freeze(o, !o.frozen)
      },
      {
        label: 'Resize',
        run: () => window.physics?.beginresize()
      },
      { sep: true },
      {
        label: 'Delete',
        danger: true,
        run: () => window.physics?.destroy(o)
      }
    ];
  }

  function show(x, y) {
    const under = document.elementFromPoint(x, y);
    if (under?.closest?.('.browser-card')) return;
    if (under?.closest?.('.th-screen')) return;
    if (under?.closest?.('.menu')) return;

    close();
    flag(true);

    const hit = window.physics?.pick?.(x, y);
    if (hit) {
      target = hit;
      window.physics.select(hit);
      build(objectmenu(hit), x, y, 0);
    } else {
      window.physics?.deselect?.();
      build(worldmenu(x, y), x, y, 0);
    }
  }

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    show(e.clientX, e.clientY);
  });

  window.overlay?.onmenu?.(({ x, y }) => show(x, y));

  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('.menu')) return;
    if (!active()) return;

    const keep = e.target.closest?.('.axis') || (target && e.target === target.el);
    close();
    if (!keep) window.physics?.deselect?.();
  }, true);

  window.addEventListener('blur', close);
  window.addEventListener('resize', close);

  window.menu = { show, close, isopen: active };
})();
