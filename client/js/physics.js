(() => {
  const { Engine, Bodies, Body, Composite, Constraint, Sleeping, Events } = Matter;

  const broadcastms = 50;
  const throwwindow = 120;
  const throwmax = 48;
  const maxobjects = 440;
  const authorityms = 4000;
  const wallthick = 200;

  const dragstiff = 0.16;
  const dragdamp = 0.3;

  const bounce = 0.75;

  const moveforce = 0.0042;
  const maxrun = 8.5;
  const aircontrol = 0.4;
  const jump = 0.16;
  const brake = 0.06;

  const uprighttorque = 0.512;
  const uprightdamp = 0.156;
  const uprightair = 0.25;
  const knock = 7;

  const grace = 110;
  const inkcell = 16;

  const minhalf = 10;
  const maxhalf = 260;

  const layer = document.createElement('div');
  layer.id = 'object-world';
  document.body.appendChild(layer);

  const handles = document.createElement('div');
  handles.id = 'handleroot';
  document.body.appendChild(handles);

  const engine = Engine.create({
    gravity: { x: 0, y: 2.6 },
    enableSleeping: true
  });
  engine.positionIterations = 10;
  engine.velocityIterations = 8;

  const objects = new Map();
  const bybody = new Map();
  let myid = null;
  let seq = 0;

  const shapes = {
    box:      { w: 46, h: 46 },
    ball:     { w: 44, h: 44 },
    crate:    { w: 66, h: 40 },
    triangle: { w: 50, h: 46 }
  };

  const uid = () => `${myid || 'x'}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

  let walls = [];
  function buildwalls() {
    if (walls.length) Composite.remove(engine.world, walls);
    const w = window.innerWidth, h = window.innerHeight;
    const opts = { isStatic: true, friction: 1.0, restitution: bounce, label: 'wall' };

    walls = [
      Bodies.rectangle(w / 2, h + wallthick / 2, w * 3, wallthick, opts),
      Bodies.rectangle(w / 2, -wallthick / 2, w * 3, wallthick, opts),
      Bodies.rectangle(-wallthick / 2, h / 2, wallthick, h * 3, opts),
      Bodies.rectangle(w + wallthick / 2, h / 2, wallthick, h * 3, opts)
    ];
    Composite.add(engine.world, walls);
  }
  buildwalls();
  window.addEventListener('resize', buildwalls);

  let ink = [];
  let inkqueued = false;

  function buildink() {
    if (!window.draw?.isink) return;

    if (ink.length) {
      Composite.remove(engine.world, ink);
      ink = [];
    }

    const w = window.innerWidth, h = window.innerHeight;
    const opts = { isStatic: true, friction: 1.0, restitution: bounce, label: 'ink' };

    for (let y = 0; y < h; y += inkcell) {
      let run = -1;
      for (let x = 0; x <= w; x += inkcell) {
        const solid = x < w && window.draw.isink(x + inkcell / 2, y + inkcell / 2);
        if (solid && run < 0) run = x;
        if ((!solid || x >= w) && run >= 0) {
          const span = x - run;
          ink.push(Bodies.rectangle(
            run + span / 2, y + inkcell / 2, span, inkcell, opts
          ));
          run = -1;
        }
      }
    }
    if (ink.length) Composite.add(engine.world, ink);
    objects.forEach(o => { if (!o.frozen) Sleeping.set(o.body, false); });
  }

  function queueink() {
    if (inkqueued) return;
    inkqueued = true;
    setTimeout(() => { inkqueued = false; buildink(); }, 180);
  }

  function contact(a, b) {
    const check = (self, other) => {
      const p = bybody.get(self);
      if (!p) return;
      if (other.position.y > self.position.y + p.hh * 0.35) {
        p.grounded = performance.now();
      }
      p.touched = performance.now();
    };
    check(a, b);
    check(b, a);
  }

  Events.on(engine, 'collisionStart', (e) => {
    for (const pair of e.pairs) contact(pair.bodyA, pair.bodyB);
  });
  Events.on(engine, 'collisionActive', (e) => {
    for (const pair of e.pairs) contact(pair.bodyA, pair.bodyB);
  });

  const isgrounded = (p) => performance.now() - (p.grounded || 0) < grace;
  const istouching = (p) => performance.now() - (p.touched || 0) < grace;

  function make(id, shape, color, owner, x, y, hw, hh) {
    const spec = shapes[shape] || shapes.box;
    const halfw = hw || spec.w / 2;
    const halfh = hh || spec.h / 2;

    const el = document.createElement('div');
    el.className = `phys-obj phys-${shape} interactive`;
    el.style.width = halfw * 2 + 'px';
    el.style.height = halfh * 2 + 'px';
    el.style.setProperty('--obj-color', color);
    layer.appendChild(el);

    const opts = {
      friction: 0.75,
      frictionStatic: 1.1,
      frictionAir: 0.006,
      restitution: bounce,
      density: 0.0022,
      sleepThreshold: 40,
      label: 'obj'
    };

    let body;
    if (shape === 'ball') body = Bodies.circle(x, y, halfw, opts);
    else if (shape === 'triangle') body = Bodies.polygon(x, y, 3, halfw, opts);
    else body = Bodies.rectangle(x, y, halfw * 2, halfh * 2, opts);

    Composite.add(engine.world, body);

    const o = {
      id, el, body, shape, color, owner,
      hw: halfw, hh: halfh,
      frozen: false,
      until: 0,
      dragging: false,
      constraint: null,
      history: []
    };

    Object.defineProperty(o, 'mine', { get() { return this.owner === myid; } });

    objects.set(id, o);
    binddrag(o);
    draw(o);
    window.players?.updateflag?.();
    return o;
  }

  function recover(body) {
    if (!body || body.isStatic) return;
    const p = body.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) ||
        p.y > window.innerHeight + 2000 || p.y < -2000 ||
        p.x > window.innerWidth + 2000 || p.x < -2000) {
      Body.setPosition(body, { x: window.innerWidth / 2, y: 100 });
      Body.setVelocity(body, { x: 0, y: 0 });
      Body.setAngularVelocity(body, 0);
    }
  }

  function draw(o) {
    recover(o.body);
    o.el.style.transform =
      `translate(${(o.body.position.x - o.hw).toFixed(1)}px, ${(o.body.position.y - o.hh).toFixed(1)}px) ` +
      `rotate(${(o.body.angle * 180 / Math.PI).toFixed(2)}deg)`;
  }

  function remove(id, quiet) {
    const o = objects.get(id);
    if (!o) return;
    if (selected === o) deselect();
    release(o);
    Composite.remove(engine.world, o.body);
    o.el.remove();
    objects.delete(id);
    window.players?.updateflag?.();
    if (!quiet && o.mine) window.party.broadcast({ t: 'objdel', id });
  }

  function claim(o) {
    const had = o.mine;
    o.owner = myid;
    o.until = performance.now() + authorityms;
    if (!had) window.party.broadcast({ t: 'objclaim', id: o.id });
  }

  function release(entity) {
    if (!entity || !entity.constraint) return;
    Composite.remove(engine.world, entity.constraint);
    entity.constraint = null;
  }

  function freeze(o, on) {
    if (!o || o.frozen === on) return;
    o.frozen = on;
    release(o);
    Body.setStatic(o.body, on);
    if (!on) {
      Sleeping.set(o.body, false);
      Body.setVelocity(o.body, { x: 0, y: 0 });
      Body.setAngularVelocity(o.body, 0);
    }
    o.el.classList.toggle('frozen', on);
  }

  function resize(o, hw, hh) {
    if (!o) return;
    const nextw = Math.max(minhalf, Math.min(maxhalf, hw));
    const nexth = o.shape === 'ball'
      ? nextw
      : Math.max(minhalf, Math.min(maxhalf, hh));

    const sx = nextw / o.hw;
    const sy = nexth / o.hh;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return;

    const wasstatic = o.body.isStatic;
    if (wasstatic) Body.setStatic(o.body, false);
    Body.scale(o.body, sx, sy);
    if (wasstatic) Body.setStatic(o.body, true);

    o.hw = nextw;
    o.hh = nexth;
    o.el.style.width = nextw * 2 + 'px';
    o.el.style.height = nexth * 2 + 'px';

    if (!o.frozen) Sleeping.set(o.body, false);
    draw(o);
  }

  function attachbody(p, x, y) {
    const body = Bodies.rectangle(x, y, p.hw * 2, p.hh * 2, {
      friction: 0.7,
      frictionStatic: 1.0,
      frictionAir: 0.008,
      restitution: bounce * 0.6,
      density: 0.0042,
      sleepThreshold: Infinity,
      label: 'player'
    });
    Composite.add(engine.world, body);
    p.body = body;
    p.grounded = 0;
    p.touched = 0;
    bybody.set(body, p);
    return body;
  }

  function detachbody(p) {
    release(p);
    if (p.body) {
      bybody.delete(p.body);
      Composite.remove(engine.world, p.body);
      p.body = null;
    }
  }

  function drive(p) {
    if (!p.body || !p.owner || p.dragging) return;

    const b = p.body;
    const keys = window.players.keys;
    const ground = isgrounded(p);

    let dir = 0;
    if (keys.a) dir -= 1;
    if (keys.d) dir += 1;

    if (dir !== 0) {
      const ratio = Math.min(1, Math.abs(b.velocity.x) / maxrun);
      const same = Math.sign(b.velocity.x) === dir;
      const taper = same ? (1 - ratio * ratio) : 1;

      Body.applyForce(b, b.position, {
        x: dir * moveforce * b.mass * taper * (ground ? 1 : aircontrol),
        y: 0
      });
    } else if (ground) {
      Body.applyForce(b, b.position, {
        x: -b.velocity.x * brake * b.mass * 0.01,
        y: 0
      });
    }

    if (keys.w && ground) {
      Body.applyForce(b, b.position, { x: 0, y: -jump * b.mass });
      p.grounded = 0;
    }

    let err = b.angle;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;

    const speed = Math.hypot(b.velocity.x, b.velocity.y);
    const factor = Math.max(0, 1 - speed / knock);
    const scale = (ground || istouching(p)) ? 1 : uprightair;

    b.torque += (-err * uprighttorque - b.angularVelocity * uprightdamp)
                * b.mass * scale * factor;
  }

  function applyremote(p, m) {
    if (!p.body) return;
    Body.setPosition(p.body, {
      x: m.x * window.innerWidth,
      y: m.y * window.innerHeight
    });
    Body.setAngle(p.body, m.rot || 0);
    Body.setVelocity(p.body, { x: m.vx || 0, y: m.vy || 0 });
    Body.setAngularVelocity(p.body, m.w || 0);
  }

  function begindrag(entity, x, y) {
    if (!entity.body) return;
    release(entity);

    const pos = entity.body.position;
    const dx = x - pos.x, dy = y - pos.y;
    const c = Math.cos(-entity.body.angle), s = Math.sin(-entity.body.angle);

    entity.constraint = Constraint.create({
      pointA: { x, y },
      bodyB: entity.body,
      pointB: { x: dx * c - dy * s, y: dx * s + dy * c },
      stiffness: dragstiff,
      damping: dragdamp,
      length: 0
    });
    Composite.add(engine.world, entity.constraint);

    Sleeping.set(entity.body, false);
    entity.dragging = true;
    entity.history = [{ x, y, t: performance.now() }];
    window.dragging = true;
    window.overlay.playeractive?.(true);
  }

  function movedrag(entity, x, y) {
    if (!entity.constraint) return;
    entity.constraint.pointA = { x, y };
    const now = performance.now();
    entity.history.push({ x, y, t: now });
    while (entity.history.length > 1 && now - entity.history[0].t > throwwindow) {
      entity.history.shift();
    }
  }

  function enddrag(entity, x, y) {
    release(entity);
    window.dragging = false;
    window.overlay.playeractive?.(false);
    if (!entity.dragging) return null;
    entity.dragging = false;

    const t = performance.now();
    entity.history.push({ x, y, t });
    while (entity.history.length > 1 && t - entity.history[0].t > throwwindow) {
      entity.history.shift();
    }

    if (entity.history.length >= 2 && entity.body) {
      const first = entity.history[0], last = entity.history[entity.history.length - 1];
      const dt = (last.t - first.t) / 1000;
      if (dt > 0.005) {
        let vx = ((last.x - first.x) / dt) / 60;
        let vy = ((last.y - first.y) / dt) / 60;
        const speed = Math.hypot(vx, vy);
        if (speed > throwmax) { vx *= throwmax / speed; vy *= throwmax / speed; }
        Body.setVelocity(entity.body, { x: vx, y: vy });
      } else {
        Body.setVelocity(entity.body, { x: 0, y: 0 });
      }
    }
    entity.history = [];
    return entity.body ? entity.body.velocity : null;
  }

  function bindplayerdrag(p) {
    if (p.bound) return;
    p.bound = true;

    p.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      begindrag(p, e.clientX, e.clientY);

      const move = (ev) => movedrag(p, ev.clientX, ev.clientY);
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        enddrag(p, ev.clientX, ev.clientY);
        window.players.checkkill(p, ev.clientX, ev.clientY);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  function binddrag(o) {
    o.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      claim(o);

      if (o.frozen) {
        const pos = o.body.position;
        const offx = e.clientX - pos.x, offy = e.clientY - pos.y;

        window.dragging = true;
        window.overlay.playeractive?.(true);

        const move = (ev) => {
          Body.setPosition(o.body, { x: ev.clientX - offx, y: ev.clientY - offy });
          draw(o);
          window.party.broadcast({
            t: 'objstate', id: o.id,
            x: o.body.position.x / window.innerWidth,
            y: o.body.position.y / window.innerHeight,
            rot: o.body.angle, vx: 0, vy: 0, w: 0, frozen: true
          });
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          window.dragging = false;
          window.overlay.playeractive?.(false);
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        return;
      }

      begindrag(o, e.clientX, e.clientY);
      window.party.broadcast({ t: 'objgrab', id: o.id });

      const move = (ev) => movedrag(o, ev.clientX, ev.clientY);
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);

        const v = enddrag(o, ev.clientX, ev.clientY);
        if (v) {
          window.party.broadcast({
            t: 'objrelease', id: o.id, vx: v.x, vy: v.y, w: o.body.angularVelocity
          });
        }
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  function share(o) {
    const p = o.body.position, v = o.body.velocity;
    window.party.broadcast({
      t: 'objstate', id: o.id,
      x: p.x / window.innerWidth, y: p.y / window.innerHeight,
      rot: o.body.angle, vx: v.x, vy: v.y, w: o.body.angularVelocity
    });
  }

  let selected = null;
  let marquee = null;
  let sizing = false;
  const arms = [];

  function select(o) {
    if (selected === o) return;
    deselect();
    selected = o;

    marquee = document.createElement('div');
    marquee.className = 'marquee';
    layer.appendChild(marquee);
    paintselection();
  }

  function deselect() {
    endresize();
    marquee?.remove();
    marquee = null;
    selected = null;
  }

  function paintselection() {
    if (!selected || !marquee) return;
    const pad = 7;
    const w = selected.hw * 2 + pad * 2;
    const h = selected.hh * 2 + pad * 2;
    marquee.style.width = w + 'px';
    marquee.style.height = h + 'px';
    marquee.style.transform =
      `translate(${(selected.body.position.x - w / 2).toFixed(1)}px, ${(selected.body.position.y - h / 2).toFixed(1)}px) ` +
      `rotate(${(selected.body.angle * 180 / Math.PI).toFixed(2)}deg)`;
  }

  function beginresize() {
    if (!selected || sizing) return;
    sizing = true;

    ['x', 'y'].forEach(axis => {
      const line = document.createElement('div');
      line.className = `axisline axis${axis}`;
      const knob = document.createElement('div');
      knob.className = `axis axis${axis} interactive`;
      knob.textContent = axis === 'x' ? '↔' : '↕';
      handles.append(line, knob);
      arms.push({ axis, line, knob });
      bindarm(arms[arms.length - 1]);
    });

    paintarms();
  }

  function endresize() {
    sizing = false;
    arms.splice(0).forEach(a => { a.line.remove(); a.knob.remove(); });
  }

  function armreach(o, axis) {
    return (axis === 'x' ? o.hw : o.hh) + 34;
  }

  function paintarms() {
    if (!selected || !sizing) return;
    const pos = selected.body.position;
    const angle = selected.body.angle;

    arms.forEach(a => {
      const dir = a.axis === 'x' ? angle : angle - Math.PI / 2;
      const reach = armreach(selected, a.axis);
      const x = pos.x + Math.cos(dir) * reach;
      const y = pos.y + Math.sin(dir) * reach;

      a.knob.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      a.line.style.width = reach + 'px';
      a.line.style.transform =
        `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px) rotate(${(dir * 180 / Math.PI).toFixed(2)}deg)`;
    });
  }

  function bindarm(arm) {
    arm.knob.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!selected) return;
      const o = selected;
      claim(o);

      window.dragging = true;
      window.overlay.playeractive?.(true);

      const move = (ev) => {
        const pos = o.body.position;
        const angle = o.body.angle;
        const dir = arm.axis === 'x' ? angle : angle - Math.PI / 2;
        const dx = ev.clientX - pos.x;
        const dy = ev.clientY - pos.y;
        const along = Math.abs(dx * Math.cos(dir) + dy * Math.sin(dir)) - 34;

        if (arm.axis === 'x') resize(o, along, o.hh);
        else resize(o, o.hw, along);

        paintselection();
        paintarms();
      };

      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        window.dragging = false;
        window.overlay.playeractive?.(false);
        window.party.broadcast({ t: 'objsize', id: o.id, hw: o.hw, hh: o.hh });
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  let lastshare = 0;
  let lasttime = 0;

  function tick(now) {
    try {
      const dt = lasttime ? Math.min(33, now - lasttime) : 16.7;
      lasttime = now;

      objects.forEach(o => {
        if (o.mine && o.until && now > o.until && !o.dragging) o.until = 0;
      });

      const people = window.players?.bodies?.() || [];
      people.forEach(p => drive(p));

      Engine.update(engine, dt);

      people.forEach(p => {
        recover(p.body);
        window.players.render(p);
      });
      objects.forEach(o => draw(o));

      paintselection();
      paintarms();

      if (now - lastshare > broadcastms) {
        lastshare = now;
        objects.forEach(o => {
          if (!o.mine || o.frozen || o.body.isSleeping) return;
          share(o);
        });
      }
    } catch (err) {
      console.error('[physics] frame error:', err);
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function spawn(shape, atx, aty) {
    if (objects.size >= maxobjects) return null;
    const id = uid();
    const color = window.party.colorfor(myid);
    const x = atx ?? (window.innerWidth / 2 + (Math.random() - 0.5) * 260);
    const y = aty ?? 120;

    const o = make(id, shape, color, myid, x, y);
    Body.setVelocity(o.body, { x: (Math.random() - 0.5) * 4, y: 0 });
    Body.setAngularVelocity(o.body, (Math.random() - 0.5) * 0.1);

    window.party.broadcast({
      t: 'objnew', id, shape, color,
      x: x / window.innerWidth, y: y / window.innerHeight
    });
    return o;
  }

  function clearmine() {
    [...objects.values()].filter(o => o.mine).forEach(o => remove(o.id));
  }

  function pick(x, y) {
    const el = document.elementFromPoint(x, y);
    const hit = el?.closest?.('.phys-obj');
    if (!hit) return null;
    for (const o of objects.values()) if (o.el === hit) return o;
    return null;
  }

  window.party?.onmessage((from, m) => {
    if (m.t === 'objnew') {
      if (objects.has(m.id)) return;
      make(m.id, m.shape, m.color, from,
        m.x * window.innerWidth, m.y * window.innerHeight, m.hw, m.hh);
    }
    else if (m.t === 'objclaim') {
      const o = objects.get(m.id);
      if (!o) return;
      o.owner = from;
      o.until = 0;
    }
    else if (m.t === 'objstate') {
      const o = objects.get(m.id);
      if (!o || o.dragging) return;
      if (o.mine && o.until > performance.now()) return;
      o.owner = from;
      if (!o.frozen) Sleeping.set(o.body, false);
      Body.setPosition(o.body, {
        x: m.x * window.innerWidth,
        y: m.y * window.innerHeight
      });
      Body.setAngle(o.body, m.rot);
      if (!o.frozen) {
        Body.setVelocity(o.body, { x: m.vx, y: m.vy });
        Body.setAngularVelocity(o.body, m.w);
      }
      draw(o);
    }
    else if (m.t === 'objdel') remove(m.id, true);
    else if (m.t === 'objfreeze') {
      const o = objects.get(m.id);
      if (o) freeze(o, !!m.on);
    }
    else if (m.t === 'objsize') {
      const o = objects.get(m.id);
      if (o) resize(o, m.hw, m.hh);
    }
    else if (m.t === 'objgrab') {
      const o = objects.get(m.id);
      if (!o) return;
      o.owner = from;
      if (!o.frozen) Sleeping.set(o.body, false);
    }
    else if (m.t === 'objrelease') {
      const o = objects.get(m.id);
      if (!o || o.dragging || o.frozen) return;
      Sleeping.set(o.body, false);
      Body.setVelocity(o.body, { x: m.vx, y: m.vy });
      Body.setAngularVelocity(o.body, m.w);
    }
  });

  window.overlay.onidentity(({ userid }) => { myid = userid; });

  window.overlay.onroster(({ members }) => {
    const set = new Set(members || []);
    objects.forEach(o => {
      if (!set.has(o.owner) && o.owner !== myid) claim(o);
    });
  });

  function snapshot() {
    return [...objects.values()].map(o => ({
      id: o.id, shape: o.shape, color: o.color, owner: o.owner,
      hw: o.hw, hh: o.hh,
      x: o.body.position.x, y: o.body.position.y,
      angle: o.body.angle, frozen: o.frozen
    }));
  }

  function wipe() {
    [...objects.keys()].forEach(id => remove(id, true));
  }

  function restore(list) {
    (list || []).forEach(d => {
      if (objects.has(d.id)) return;
      const o = make(d.id, d.shape, d.color, d.owner, d.x, d.y, d.hw, d.hh);
      Body.setAngle(o.body, d.angle);
      Body.setVelocity(o.body, { x: 0, y: 0 });
      Body.setAngularVelocity(o.body, 0);
      if (d.frozen) freeze(o, true);
      draw(o);
    });
  }

  window.physics = {
    count: () => objects.size,
    snapshot,
    wipe,
    restore,
    shapes: () => Object.keys(shapes),
    spawn,
    clearmine,
    pick,
    select,
    deselect,
    beginresize,
    endresize,

    freeze(o, on) {
      claim(o);
      freeze(o, on);
      window.party.broadcast({ t: 'objfreeze', id: o.id, on });
    },

    destroy(o) { remove(o.id); },

    attachbody(p, x, y) {
      attachbody(p, x, y);
      bindplayerdrag(p);
    },
    detachbody,
    begindrag,
    movedrag,
    enddrag(p, x, y) {
      enddrag(p, x, y);
      window.players.checkkill(p, x, y);
    },
    applyremote,

    onpeer(id) {
      objects.forEach(o => {
        if (!o.mine) return;
        const p = o.body.position;
        window.party.sendto(id, {
          t: 'objnew', id: o.id, shape: o.shape, color: o.color,
          hw: o.hw, hh: o.hh,
          x: p.x / window.innerWidth, y: p.y / window.innerHeight
        });
        if (o.frozen) window.party.sendto(id, { t: 'objfreeze', id: o.id, on: true });
      });
    },

    rebuildink: queueink
  };
})();
