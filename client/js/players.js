(() => {
  const width = 34;
  const height = 52;
  const margin = 60;
  const broadcastms = 50;
  const threshold = 90;

  const world = document.createElement('div');
  world.id = 'player-world';
  document.body.appendChild(world);

  const players = new Map();
  let myid = null;

  const keys = { a: false, d: false, w: false };
  const typing = (e) => {
    const el = e.target;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  };

  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    const k = e.key.toLowerCase();
    if (k === 'a' || k === 'd' || k === 'w') keys[k] = true;
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'a' || k === 'd' || k === 'w') keys[k] = false;
  });

  function updateflag() {
    window.hasplayers = players.size > 0 || (window.physics?.count() > 0);
  }

  const namefor = (id) => window.party?.infofor?.(id)?.name || id;
  const skinfor = (id) => window.party?.infofor?.(id)?.character || '';

  function applylook(el, color, skin) {
    el.style.setProperty('--player-color', color);
    if (skin) {
      el.style.backgroundImage = `url('${skin}')`;
      el.classList.add('has-character');
    } else {
      el.style.backgroundImage = '';
      el.classList.remove('has-character');
    }
  }

  function make(id, color, mine, skin, x, y) {
    const wrap = document.createElement('div');
    wrap.className = 'player-wrap';

    const tag = document.createElement('span');
    tag.className = 'player-tag';
    tag.textContent = namefor(id);
    tag.style.setProperty('--player-color', color);

    const el = document.createElement('div');
    el.className = 'player interactive';
    el.style.width = width + 'px';
    el.style.height = height + 'px';
    applylook(el, color, skin || skinfor(id));

    wrap.append(tag, el);
    world.appendChild(wrap);

    const p = {
      id, el, wrap, owner: mine,
      hw: width / 2, hh: height / 2,
      body: null,
      dragging: false,
      constraint: null,
      grounded: 0,
      touched: 0,
      history: []
    };

    players.set(id, p);
    window.physics?.attachbody?.(p, x, y);
    render(p);
    updateflag();
    return p;
  }

  function render(p) {
    if (!p.body) return;
    const pos = p.body.position;
    p.wrap.style.transform = `translate(${(pos.x - p.hw).toFixed(1)}px, ${(pos.y - p.hh).toFixed(1)}px)`;
    p.el.style.transform = `rotate(${(p.body.angle * 180 / Math.PI).toFixed(2)}deg)`;
  }

  function despawn(id, quiet) {
    const p = players.get(id);
    if (!p) return;
    window.physics?.detachbody?.(p);
    p.wrap.remove();
    players.delete(id);
    updateflag();
    if (id === myid && !quiet) window.party.broadcast({ t: 'pld' });
  }

  let sent = 0;
  function beat(now) {
    const me = myid && players.get(myid);
    if (me?.body && now - sent > broadcastms) {
      sent = now;
      const pos = me.body.position, v = me.body.velocity;
      window.party.broadcast({
        t: 'plu',
        x: pos.x / window.innerWidth, y: pos.y / window.innerHeight,
        vx: v.x, vy: v.y,
        rot: me.body.angle, w: me.body.angularVelocity
      });
    }
    requestAnimationFrame(beat);
  }
  requestAnimationFrame(beat);

  const handle = document.getElementById('partyavatar');
  let holding = false, armed = true, origin = null, spawned = null;

  handle?.addEventListener('pointerdown', (e) => {
    if (!myid) return;
    e.preventDefault();
    holding = true;
    armed = true;
    spawned = null;
    origin = { x: e.clientX, y: e.clientY };
    try { handle.setPointerCapture(e.pointerId); } catch {}
  });

  handle?.addEventListener('pointermove', (e) => {
    if (!holding) return;

    if (armed) {
      const dx = e.clientX - origin.x, dy = e.clientY - origin.y;
      const dist = Math.hypot(dx, dy);

      if (dist >= threshold) {
        armed = false;
        handle.classList.remove('ready');

        despawn(myid, true);
        const color = window.party.colorfor(myid);
        const skin = window.party.infofor(myid).character || '';
        spawned = make(myid, color, true, skin, e.clientX, e.clientY);

        window.party.broadcast({
          t: 'pls',
          x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight,
          color, skin
        });

        window.physics?.begindrag?.(spawned, e.clientX, e.clientY);
        return;
      }

      handle.classList.toggle('ready', dist > threshold * 0.85);
      return;
    }

    if (spawned) window.physics?.movedrag?.(spawned, e.clientX, e.clientY);
  });

  const letgo = (e) => {
    if (!holding) return;
    holding = false;
    handle.classList.remove('ready');

    if (armed) return;
    if (spawned) {
      window.physics?.enddrag?.(spawned, e.clientX, e.clientY);
      spawned = null;
    }
  };
  handle?.addEventListener('pointerup', letgo);
  handle?.addEventListener('pointercancel', letgo);

  window.party?.onmessage((from, m) => {
    if (m.t === 'pls') {
      despawn(from, true);
      make(
        from,
        m.color || window.party.colorfor(from),
        false,
        m.skin || '',
        m.x * window.innerWidth,
        m.y * window.innerHeight
      );
    }
    else if (m.t === 'pld') despawn(from, true);
    else if (m.t === 'plu') {
      const p = players.get(from);
      if (!p || p.owner || !p.body) return;
      window.physics?.applyremote?.(p, m);
    }
  });

  window.overlay.onidentity(({ userid }) => { myid = userid; });

  window.overlay.onprofile(() => {
    const p = players.get(myid);
    if (!p) return;
    applylook(p.el, window.party.colorfor(myid), skinfor(myid));
  });

  window.overlay.onroster(({ members }) => {
    const set = new Set(members || []);
    players.forEach((p, id) => { if (id !== myid && !set.has(id)) despawn(id, true); });
  });

  function snapshot() {
    const out = [];
    players.forEach((p, id) => {
      if (!p.body) return;
      out.push({
        id,
        owner: p.owner,
        color: p.el.style.getPropertyValue('--player-color'),
        skin: skinfor(id),
        x: p.body.position.x,
        y: p.body.position.y
      });
    });
    return out;
  }

  function wipe() {
    [...players.keys()].forEach(id => despawn(id, true));
  }

  function restore(list) {
    (list || []).forEach(d => {
      if (players.has(d.id)) return;
      make(d.id, d.color || window.party.colorfor(d.id), d.owner, d.skin, d.x, d.y);
    });
  }

  window.players = {
    despawn,
    snapshot,
    wipe,
    restore,
    updateflag,
    render,
    keys,
    myid: () => myid,
    all: () => players,

    bodies() {
      const out = [];
      players.forEach(p => { if (p.body) out.push(p); });
      return out;
    },

    checkkill(p, x, y) {
      if (p.dragging) return false;
      const off =
        x < -margin || x > window.innerWidth + margin ||
        y < -margin || y > window.innerHeight + margin;
      if (off) {
        despawn(p.id, !p.owner);
        if (p.owner) window.overlay.playeractive?.(false);
        return true;
      }
      return false;
    }
  };
})();
