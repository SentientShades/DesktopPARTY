(() => {
  const tablew = 16;
  const tabled = 10;
  const wallh = 3;
  const wallthick = 2;
  const gravity = -24;

  const diehalf = 0.5;
  const dieroundradius = 0.08;
  const spawnheight = 6;
  const tossspeed = 10;
  const spinspeed = 24;
  const diefriction = 0.22;
  const dierestitution = 0.38;
  const diedamp = 0.07;

  const boundfriction = 0.4;
  const boundrestitution = 0.42;

  const broadcastms = 60;
  const authorityms = 4000;
  const revealholdms = 900;
  const revealfadems = 550;
  const shrinkms = 420;
  const badgelifems = 20000;
  const convergetravelms = 480;
  const forcesettlems = 9000;
  const boundxmargin = tablew / 2 + wallthick + 2;
  const boundzmargin = tabled / 2 + wallthick + 2;
  const boundymin = -4;
  const boundymax = 40;

  let THREE = null;
  let RAPIER = null;
  let RoundedBoxGeometry = null;
  let GLTFLoader = null;
  let scene = null;
  let camera = null;
  let renderer = null;
  let canvas = null;
  let world = null;
  let eventqueue = null;
  let groundplane = null;
  let raycaster = null;

  let myid = null;
  let seq = 0;
  let ready = false;
  let booting = null;
  let lastshare = 0;

  const dice = new Map();
  const bycollider = new Map();
  const convergingbatches = new Set();

  const uid = () => `${myid || 'x'}-d${Date.now().toString(36)}-${(seq++).toString(36)}`;
  const note = (t) => window.debuglog?.('out', 'tabletop', t);

  const facevalues = [3, 4, 1, 6, 2, 5];

  function parsehex(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    const n = parseInt(m ? m[1] : '23d18b', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255);
  }

  function tohsl([r, g, b]) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function fromhsl([h, s, l]) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)];
  }

  function lum(rgb) {
    const lin = rgb.map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function contrast(a, b) {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  function dicecolors(owner) {
    const [h, sat, l] = tohsl(parsehex(window.party?.colorfor?.(owner)));
    const body = fromhsl([h, sat * 0.6, Math.max(0.16, l * 0.72)]);
    const dark = [0.08, 0.08, 0.08];
    const pip = contrast(body, dark) < 4.5 ? [1, 1, 1] : dark;
    const css = (rgb) => `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
    return { body: css(body), pip: css(pip) };
  }

  function pipcanvas(value, colors) {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');

    ctx.fillStyle = colors.body;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(0,0,0,.12)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
    const layouts = {
      1: [[0, 0]],
      2: [[-1, -1], [1, 1]],
      3: [[-1, -1], [0, 0], [1, 1]],
      4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
      5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
      6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]
    };

    const step = size * 0.24;
    const cx = size / 2, cy = size / 2;
    const r = size * 0.09;

    ctx.fillStyle = colors.pip;
    layouts[value].forEach(([gx, gy]) => {
      ctx.beginPath();
      ctx.arc(cx + gx * step, cy + gy * step, r, 0, Math.PI * 2);
      ctx.fill();
    });

    return c;
  }

  let shadowtex = null;
  function shadowtexture(THREE) {
    if (shadowtex) return shadowtex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,.5)');
    g.addColorStop(0.7, 'rgba(0,0,0,.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    shadowtex = new THREE.CanvasTexture(c);
    return shadowtex;
  }


  let actx = null;
  let noisebuf = null;
  let lastimpactat = 0;
  const impactgapms = 35;

  function ensureaudio() {
    if (actx) return actx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    actx = new Ctx();
    return actx;
  }

  function noisebuffer(ctx) {
    if (noisebuf && noisebuf.sampleRate === ctx.sampleRate) return noisebuf;
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noisebuf = buf;
    return buf;
  }

  function impactsound(strength, diedie) {
    const now = performance.now();
    if (now - lastimpactat < impactgapms) return;
    const ctx = ensureaudio();
    if (!ctx) return;
    const s = Math.max(0, Math.min(1, strength));
    if (s < 0.03) return; 
    lastimpactat = now;

    const src = ctx.createBufferSource();
    src.buffer = noisebuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = diedie ? 'bandpass' : (Math.random() < 0.5 ? 'highpass' : 'bandpass');
    filter.frequency.value = (diedie ? 1600 : 800) + (Math.random() - 0.5) * 600 + s * 900;
    filter.Q.value = (diedie ? 3 : 1.2) + Math.random() * 1.5;

    const gain = ctx.createGain();
    const peak = 0.05 + s * 0.5;
    const t0 = ctx.currentTime;
    const decay = 0.03 + s * 0.06 + Math.random() * 0.03;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + decay);

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + decay + 0.05);
  }

  function throwwhoosh() {
    const ctx = ensureaudio();
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noisebuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.7;
    const t0 = ctx.currentTime;
    filter.frequency.setValueAtTime(280, t0);
    filter.frequency.linearRampToValueAtTime(1400, t0 + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.12, t0 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.22);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + 0.25);
  }

  function settlechime() {
    const ctx = ensureaudio();
    if (!ctx) return;
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.07;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.09, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    });
  }

  function startrolling(d) {
    const ctx = ensureaudio();
    if (!ctx || d.rollnode) return;
    const src = ctx.createBufferSource();
    src.buffer = noisebuffer(ctx);
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280 + d.tonejitter;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    d.rollnode = { src, filter, gain };
  }

  function updaterolling(d, speed) {
    if (!d.rollnode) return;
    const ctx = ensureaudio();
    if (!ctx) return;
    const t = Math.max(0, Math.min(1, speed / 8));
    d.rollnode.gain.gain.setTargetAtTime(t * 0.07, ctx.currentTime, 0.05);
    d.rollnode.filter.frequency.setTargetAtTime(260 + d.tonejitter + t * 850, ctx.currentTime, 0.06);
  }

  function stoprolling(d) {
    if (!d.rollnode) return;
    const ctx = ensureaudio();
    const { src, gain } = d.rollnode;
    d.rollnode = null;
    if (!ctx) { try { src.stop(); } catch {} return; }
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    setTimeout(() => { try { src.stop(); } catch {} }, 200);
  }

  function buildscene() {

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 19, 13);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const lamp = new THREE.PointLight(0xfff6e0, 2.0, 45, 1.4);
    lamp.position.set(0, 9, 0);
    scene.add(lamp);
    const side1 = new THREE.DirectionalLight(0xffffff, 0.7);
    side1.position.set(5, 8, 4);
    scene.add(side1);
    const side2 = new THREE.DirectionalLight(0xcfe0ff, 0.45);
    side2.position.set(-5, 8, -4);
    scene.add(side2);

    raycaster = new THREE.Raycaster();
    groundplane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  function buildbounds() {
    const make = (hx, hy, hz, x, y, z) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz)
          .setFriction(boundfriction)
          .setRestitution(boundrestitution)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body
      );
      bycollider.set(collider.handle, { kind: 'bound' });
    };
    make(tablew / 2, 0.5, tabled / 2, 0, -0.5, 0);
    make(tablew / 2, wallh / 2, wallthick / 2, 0, wallh / 2, -tabled / 2 - wallthick / 2);
    make(tablew / 2, wallh / 2, wallthick / 2, 0, wallh / 2, tabled / 2 + wallthick / 2);
    make(wallthick / 2, wallh / 2, tabled / 2, -tablew / 2 - wallthick / 2, wallh / 2, 0);
    make(wallthick / 2, wallh / 2, tabled / 2, tablew / 2 + wallthick / 2, wallh / 2, 0);
  }

  async function loadmodule(name, patches) {
    let code = await window.overlay.vendortext(name);
    (patches || []).forEach(([from, to]) => { code = code.split(from).join(to); });
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const mod = await import(url);
    return { mod, url };
  }

  let engineloading = null;

  function loadengine() {
    if (engineloading) return engineloading;
    engineloading = (async () => {
      note('loading three + rapier');

      const corecode = await window.overlay.vendortext('three.core.js');
      const coreurl = URL.createObjectURL(new Blob([corecode], { type: 'text/javascript' }));

      const [threeloaded, rapierloaded, wasmbytes] = await Promise.all([
        loadmodule('three.module.js', [["from './three.core.js'", `from '${coreurl}'`]]),
        loadmodule('rapier.mjs'),
        fetch('../vendor/rapier_wasm3d_bg.wasm').then(r => r.arrayBuffer())
      ]);

      const R = rapierloaded.mod.default ?? rapierloaded.mod;
      await R.init({ module_or_path: wasmbytes });

      THREE = threeloaded.mod;
      RAPIER = R;

      try {
        const roundedloaded = await loadmodule('RoundedBoxGeometry.js', [["from 'three'", `from '${threeloaded.url}'`]]);
        RoundedBoxGeometry = roundedloaded.mod.RoundedBoxGeometry;
      } catch (e) {
        note(`rounded geometry unavailable, using sharp corners: ${e.message}`);
      }

      try {
        const bufutilloaded = await loadmodule('BufferGeometryUtils.js', [["from 'three'", `from '${threeloaded.url}'`]]);
        const skelutilloaded = await loadmodule('SkeletonUtils.js', [["from 'three'", `from '${threeloaded.url}'`]]);
        const gltfloaded = await loadmodule('GLTFLoader.js', [
          ["from 'three'", `from '${threeloaded.url}'`],
          ["from '../utils/BufferGeometryUtils.js'", `from '${bufutilloaded.url}'`],
          ["from '../utils/SkeletonUtils.js'", `from '${skelutilloaded.url}'`]
        ]);
        GLTFLoader = gltfloaded.mod.GLTFLoader;
      } catch (e) {
        note(`gltf loader unavailable: ${e.message}`);
      }

      window.engine3d.THREE = THREE;
      window.engine3d.RAPIER = RAPIER;
      window.engine3d.RoundedBoxGeometry = RoundedBoxGeometry;
      window.engine3d.GLTFLoader = GLTFLoader;
      note('engine ready');
      return { THREE, RAPIER, RoundedBoxGeometry, GLTFLoader };
    })();
    return engineloading;
  }

  window.engine3d = { load: loadengine, THREE: null, RAPIER: null, RoundedBoxGeometry: null, GLTFLoader: null };

  function boot() {
    if (booting) return booting;
    booting = loadengine().then(() => {
      canvas = document.createElement('canvas');
      canvas.id = 'tabletop-canvas';
      canvas.style.cssText =
        'position:absolute;inset:0;z-index:247;pointer-events:none;width:100%;height:100%;';
      document.body.appendChild(canvas);

      buildscene();

      world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
      eventqueue = new RAPIER.EventQueue(true);
      buildbounds();

      ready = true;
      requestAnimationFrame(tick);
      note('ready');
    }).catch(e => {
      note(`boot failed: ${e.message}`);
      console.error('[tabletop] boot failed', e);
      window.toasts?.show({
        name: 'Dice',
        activity: `Couldn't load the table: ${e.message}`,
        status: 'offline',
        duration: 6000,
        noavatar: true
      });
      booting = null;
    });
    return booting;
  }

  function screentotable(clientx, clienty) {
    const nx = (clientx / window.innerWidth) * 2 - 1;
    const ny = -(clienty / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundplane, hit)) return { x: 0, z: 0 };
    return {
      x: Math.max(-tablew / 2 + 1, Math.min(tablew / 2 - 1, hit.x)),
      z: Math.max(-tabled / 2 + 1, Math.min(tabled / 2 - 1, hit.z))
    };
  }

  function project(vec3) {
    const v = vec3.clone().project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight
    };
  }

  function makedie(id, owner, batchid, x, y, z, vx, vy, vz, avx, avy, avz) {
    const size = diehalf * 2;
    const geo = RoundedBoxGeometry
      ? new RoundedBoxGeometry(size, size, size, 3, dieroundradius)
      : new THREE.BoxGeometry(size - dieroundradius, size - dieroundradius, size - dieroundradius);


    const colors = dicecolors(owner);
    const mats = facevalues.map(v => {
      const map = new THREE.CanvasTexture(pipcanvas(v, colors));
      map.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshStandardMaterial({ map, roughness: 0.09, metalness: 0.14 });
    });
    const mesh = new THREE.Mesh(geo, mats);
    scene.add(mesh);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(diehalf * 2.6, diehalf * 2.6),
      new THREE.MeshBasicMaterial({ map: shadowtexture(THREE), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(x, 0.006, z);
    scene.add(shadow);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinvel(vx, vy, vz)
        .setAngvel({ x: avx, y: avy, z: avz })
        .setLinearDamping(diedamp)
        .setAngularDamping(diedamp)
        .setCanSleep(true)
        .setCcdEnabled(true)
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(diehalf, diehalf, diehalf)
        .setFriction(diefriction)
        .setRestitution(dierestitution)
        .setDensity(1.6)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body
    );

    const die = {
      id, owner, batchid, until: 0, mesh, shadow, body, collider,
      wassleeping: false, settled: false, spawnat: performance.now(),
      badge: null, revealat: 0, fading: false, fadestart: 0,
      rollnode: null, tonejitter: (Math.random() - 0.5) * 160
    };
    dice.set(id, die);
    bycollider.set(collider.handle, { kind: 'die', die });
    startrolling(die);
    return die;
  }

  function removedie(id, quiet) {
    const d = dice.get(id);
    if (!d) return;
    stoprolling(d);
    d.badge?.remove();
    bycollider.delete(d.collider.handle);
    scene.remove(d.mesh);
    scene.remove(d.shadow);
    d.mesh.geometry.dispose();
    d.mesh.material.forEach(m => { m.map?.dispose(); m.dispose(); });
    d.shadow.geometry.dispose();
    d.shadow.material.dispose();
    world.removeRigidBody(d.body);
    dice.delete(id);
    if (!quiet && d.owner === myid) window.party?.broadcast({ t: 'dicedel', id });
  }

  function claim(d) {
    const had = d.owner === myid;
    d.owner = myid;
    d.until = performance.now() + authorityms;
    if (!had) window.party?.broadcast({ t: 'dicegrab', id: d.id });
  }

  function readvalue(body) {
    const q = body.rotation();
    const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const normals = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
    ];
    let best = 0, bestdot = -Infinity;
    normals.forEach((n, i) => {
      const dot = n.clone().applyQuaternion(quat).dot(new THREE.Vector3(0, 1, 0));
      if (dot > bestdot) { bestdot = dot; best = i; }
    });
    return facevalues[best];
  }

  function makebadge(value) {
    const el = document.createElement('div');
    el.textContent = String(value);
    el.style.cssText = [
      'position:absolute', 'left:0', 'top:0', 'z-index:248',
      "font-family:'Silkscreen','Consolas',monospace",
      'font-size:34px', 'font-weight:700', 'line-height:1',
      'color:#fff', '-webkit-text-stroke:5px #000', 'paint-order:stroke fill',
      'pointer-events:none', 'opacity:0', 'will-change:transform,opacity'
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), badgelifems);
    return el;
  }

  function positionbadge(d) {
    if (!d.badge) return;
    const p = project(d.mesh.position);
    d.badge.style.transform = `translate(${p.x.toFixed(1)}px, ${(p.y - 55).toFixed(1)}px) translate(-50%, -50%)`;
  }

  function dropbadge(d) {
    if (!d.badge) return;
    d.badge.remove();
    d.badge = null;
  }

  function beginreveal(d) {
    d.value = readvalue(d.body);
    stoprolling(d);

    dropbadge(d);
    d.badge = makebadge(d.value);
    positionbadge(d);

    const base = d.badge.style.transform;
    d.badge.animate(
      [
        { opacity: 0, transform: `${base} scale(0.2)` },
        { opacity: 1, transform: `${base} scale(1.3)`, offset: 0.6 },
        { opacity: 1, transform: `${base} scale(1)` }
      ],
      { duration: 320, easing: 'cubic-bezier(.22,1.4,.4,1)', fill: 'forwards' }
    );

    d.revealat = performance.now();
    d.fading = false;
  }

  function beginfade(d) {
    if (d.fading) return;
    d.fading = true;
    d.fadestart = performance.now();
    const badge = d.badge;
    if (badge) {
      badge.animate([{ opacity: 1 }, { opacity: 0 }], { duration: revealfadems, easing: 'ease-in', fill: 'forwards' });
      setTimeout(() => badge.remove(), revealfadems + 40);
    }
    d.mesh.material.forEach(m => { m.transparent = true; });
    d.shadow.material.transparent = true;
  }


  function shrinkscale(t) {
    if (t < 0.2) return 1 + (t / 0.2) * 0.12;
    const k = (t - 0.2) / 0.8;
    return 1.12 * (1 - k * k * (3 - 2 * k));
  }

  function batchdice(batchid) {
    const out = [];
    dice.forEach(d => { if (d.batchid === batchid) out.push(d); });
    return out;
  }

  function maybeconverge(batchid, now) {
    if (convergingbatches.has(batchid)) return;
    const members = batchdice(batchid);
    if (!members.length || !members.every(d => d.settled)) return;
    const lastreveal = Math.max(...members.map(d => d.revealat));
    if (now - lastreveal < revealholdms) return;

    convergingbatches.add(batchid);

    if (members.length === 1) {
      beginfade(members[0]);
      return;
    }
    beginconverge(batchid, members);
  }

  function beginconverge(batchid, members) {
    const sum = members.reduce((s, d) => s + d.value, 0);
    const cx = members.reduce((s, d) => s + d.mesh.position.x, 0) / members.length;
    const cz = members.reduce((s, d) => s + d.mesh.position.z, 0) / members.length;
    const center = project(new THREE.Vector3(cx, diehalf, cz));
    const centertf = `translate(${center.x.toFixed(1)}px, ${center.y.toFixed(1)}px) translate(-50%, -50%)`;

    members.forEach(d => {
      d.badge?.animate(
        [
          { transform: d.badge.style.transform, opacity: 1 },
          { transform: `${centertf} scale(0.25)`, opacity: 0 }
        ],
        { duration: convergetravelms, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }
      );
    });

    setTimeout(() => {
      members.forEach(d => { d.badge?.remove(); d.badge = null; });

      const sumbadge = makebadge(sum);
      sumbadge.style.fontSize = '52px';
      sumbadge.style.transform = `${centertf} scale(0.25)`;
      sumbadge.animate(
        [
          { opacity: 0, transform: `${centertf} scale(0.25)` },
          { opacity: 1, transform: `${centertf} scale(1.3)`, offset: 0.6 },
          { opacity: 1, transform: `${centertf} scale(1)` }
        ],
        { duration: 360, easing: 'cubic-bezier(.22,1.4,.4,1)', fill: 'forwards' }
      );
      settlechime();

      setTimeout(() => {
        sumbadge.animate([{ opacity: 1 }, { opacity: 0 }], { duration: revealfadems, easing: 'ease-in', fill: 'forwards' });
        members.forEach(d => beginfade(d));
        setTimeout(() => {
          sumbadge.remove();
          convergingbatches.delete(batchid);
        }, revealfadems + 60);
      }, revealholdms);
    }, convergetravelms + 20);
  }

  function tick(now) {
    if (!ready) { requestAnimationFrame(tick); return; }

    try {
      world.step(eventqueue);

      eventqueue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const a = bycollider.get(h1);
        const b = bycollider.get(h2);
        if (!a || !b) return;

        const speedof = (entry) => {
          if (entry.kind !== 'die') return 0;
          const v = entry.die.body.linvel();
          const av = entry.die.body.angvel();
          return Math.hypot(v.x, v.y, v.z) + Math.hypot(av.x, av.y, av.z) * 0.15;
        };

        const speed = Math.max(speedof(a), speedof(b));
        impactsound(Math.min(1, speed / 9), a.kind === 'die' && b.kind === 'die');
      });

      dice.forEach(d => {
        const p = d.body.translation();
        if (Math.abs(p.x) > boundxmargin || Math.abs(p.z) > boundzmargin || p.y < boundymin || p.y > boundymax) {
          note(`die ${d.id} escaped bounds, recovering`);
          d.body.setTranslation({ x: 0, y: spawnheight, z: 0 }, true);
          d.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          d.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }

        const p2 = d.body.translation();
        const r = d.body.rotation();
        d.mesh.position.set(p2.x, p2.y, p2.z);
        d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        d.shadow.position.x = p2.x;
        d.shadow.position.z = p2.z;

        if (d.owner === myid && d.until && now > d.until) d.until = 0;

        let sleeping = d.body.isSleeping();
        if (!sleeping && !d.settled && now - d.spawnat > forcesettlems) {
          const v = d.body.linvel(), av = d.body.angvel();
          if (Math.hypot(v.x, v.y, v.z) < 0.3 && Math.hypot(av.x, av.y, av.z) < 0.3) {
            d.body.sleep();
            sleeping = true;
          }
        }

        if (!sleeping) {
          const v = d.body.linvel();
          const av = d.body.angvel();
          updaterolling(d, Math.hypot(v.x, v.y, v.z) + Math.hypot(av.x, av.y, av.z) * 0.15);
        }

        if (d.fading) {
          const t = Math.min(1, (now - d.fadestart) / shrinkms);
          const s = Math.max(0.001, shrinkscale(t));
          d.mesh.scale.setScalar(s);
          d.shadow.scale.setScalar(s);
          d.mesh.material.forEach(m => { m.opacity = 1 - t * t; });
          d.shadow.material.opacity = 1 - t;
          if (t >= 1) removedie(d.id, false);
          return;
        }

        if (sleeping && !d.wassleeping && !d.settled) {
          d.settled = true;
          beginreveal(d);
        }
        if (!sleeping && d.settled) {
          d.settled = false;
          dropbadge(d);
          startrolling(d);
        }
        d.wassleeping = sleeping;

        if (d.badge) positionbadge(d);

        if (d.settled) maybeconverge(d.batchid, now);
      });

      if (now - lastshare > broadcastms) {
        lastshare = now;
        dice.forEach(d => {
          if (d.owner === myid && !d.body.isSleeping()) share(d);
        });
      }

      renderer.render(scene, camera);
    } catch (err) {
      console.error('[tabletop] frame error:', err);
    }

    requestAnimationFrame(tick);
  }

  function share(d) {
    const p = d.body.translation();
    const r = d.body.rotation();
    const v = d.body.linvel();
    const av = d.body.angvel();
    window.party?.broadcast({
      t: 'dicestate', id: d.id,
      x: p.x, y: p.y, z: p.z,
      qx: r.x, qy: r.y, qz: r.z, qw: r.w,
      vx: v.x, vy: v.y, vz: v.z,
      avx: av.x, avy: av.y, avz: av.z
    });
  }

  function throwdice(clientx, clienty, count) {
    const n = Math.max(1, Math.min(3, count || 1));
    if (!ready) {
      window.toasts?.show({
        name: 'Dice', activity: 'Setting up the table...',
        status: 'idle', duration: 3000, noavatar: true
      });
    }

    boot().then(() => {
      if (!ready) return;
      const spot = screentotable(clientx, clienty);
      const batchid = `${myid || 'x'}-b${Date.now().toString(36)}-${(seq++).toString(36)}`;

      for (let i = 0; i < n; i++) {
        const id = uid();
        const ox = spot.x + (n > 1 ? (Math.random() - 0.5) * 1.6 : 0);
        const oz = spot.z + (n > 1 ? (Math.random() - 0.5) * 1.6 : 0);
        const oy = spawnheight + i * 0.7;
        const vx = (Math.random() - 0.5) * tossspeed;
        const vz = -Math.abs((Math.random() * 0.5 + 0.3) * tossspeed);
        const avx = (Math.random() - 0.5) * spinspeed;
        const avy = (Math.random() - 0.5) * spinspeed;
        const avz = (Math.random() - 0.5) * spinspeed;

        const d = makedie(id, myid, batchid, ox, oy, oz, vx, -2, vz, avx, avy, avz);
        d.until = performance.now() + authorityms;

        window.party?.broadcast({
          t: 'dicenew', id, batchid,
          x: ox, y: oy, z: oz,
          vx, vy: -2, vz, avx, avy, avz
        });
      }
      throwwhoosh();
    });
  }

  window.party?.onmessage((from, m) => {
    if (m.t === 'dicenew') {
      if (!ready || dice.has(m.id)) return;
      makedie(m.id, from, m.batchid, m.x, m.y, m.z, m.vx, m.vy, m.vz, m.avx, m.avy, m.avz);
    }
    else if (m.t === 'dicestate') {
      const d = dice.get(m.id);
      if (!d || d.fading || (d.owner === myid && d.until > performance.now())) return;
      if (d.settled && Math.hypot(m.vx, m.vy, m.vz) + Math.hypot(m.avx, m.avy, m.avz) * 0.15 < 0.6) return;
      d.owner = from;
      d.body.setTranslation({ x: m.x, y: m.y, z: m.z }, true);
      d.body.setRotation({ x: m.qx, y: m.qy, z: m.qz, w: m.qw }, true);
      d.body.setLinvel({ x: m.vx, y: m.vy, z: m.vz }, true);
      d.body.setAngvel({ x: m.avx, y: m.avy, z: m.avz }, true);
    }
    else if (m.t === 'dicegrab') {
      const d = dice.get(m.id);
      if (d) d.owner = from;
    }
    else if (m.t === 'dicedel') {
      removedie(m.id, true);
    }
  });

  window.overlay.onidentity(({ userid }) => { myid = userid; });

  window.overlay.onroster(({ members }) => {
    if (!ready) return;
    const set = new Set(members || []);
    dice.forEach(d => { if (!set.has(d.owner) && d.owner !== myid) claim(d); });
  });

  window.tabletop = {
    throwdice,
    isready: () => ready
  };

  boot();
})();
