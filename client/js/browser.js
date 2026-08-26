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
    window.activity?.clear('Browser');
  }

  async function open(url, x, y) {
    if (card) return;
    await build(url, x, y);
    window.activity?.set(() => ({ name: 'Browser', line: 'Shared browser is open' }));
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
