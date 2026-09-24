(() => {

  const cardw = 2.5;
  const cardl = 3.4;
  const cardt = 0.006;
  const colhalf = 0.03;
  const stackgap = 0.022;

  const cardr = 0.09;

  const atlascw = 200;
  const atlasch = 272;
  const count = 52;

  const worldw = 48;
  const worldd = 27;
  const fov = 30;

  const boxw = 2.85;
  const boxh = 1.35;
  const boxd = 3.85;

  const holdy = 2.2;
  const gravity = -42;
  const broadcastms = 50;
  const stepdt = 1 / 120;
  const authorityms = 4000;
  const dragpx = 4;
  const maxthrow = 26;
  const idlerenderms = 250;

  const handw = 520;
  const handzone = 158;
  const fadems = 360;

  const redink = '#d42a3c';
  const blackink = '#1b1b24';
  const paper = '#f7f3ea';

  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const suitnames = ['spade', 'heart', 'diamond', 'club'];

  const suitmasks = {
    spade: [
      '....X....',
      '...XXX...',
      '..XXXXX..',
      '.XXXXXXX.',
      'XXXXXXXXX',
      'XXXXXXXXX',
      '.XX.X.XX.',
      '....X....',
      '...XXX...'
    ],
    heart: [
      '.XX...XX.',
      'XXXX.XXXX',
      'XXXXXXXXX',
      'XXXXXXXXX',
      '.XXXXXXX.',
      '..XXXXX..',
      '...XXX...',
      '....X....'
    ],
    diamond: [
      '....X....',
      '...XXX...',
      '..XXXXX..',
      '.XXXXXXX.',
      'XXXXXXXXX',
      '.XXXXXXX.',
      '..XXXXX..',
      '...XXX...',
      '....X....'
    ],
    club: [
      '...XXX...',
      '...XXX...',
      '.X.XXX.X.',
      'XXXXXXXXX',
      'XXXXXXXXX',
      '.X..X..X.',
      '....X....',
      '...XXX...'
    ]
  };

  const pips = {
    2: [[.5, .12], [.5, .88]],
    3: [[.5, .12], [.5, .5], [.5, .88]],
    4: [[.25, .12], [.75, .12], [.25, .88], [.75, .88]],
    5: [[.25, .12], [.75, .12], [.5, .5], [.25, .88], [.75, .88]],
    6: [[.25, .12], [.75, .12], [.25, .5], [.75, .5], [.25, .88], [.75, .88]],
    7: [[.25, .12], [.75, .12], [.5, .31], [.25, .5], [.75, .5], [.25, .88], [.75, .88]],
    8: [[.25, .12], [.75, .12], [.5, .31], [.25, .5], [.75, .5], [.5, .69], [.25, .88], [.75, .88]],
    9: [[.25, .12], [.75, .12], [.25, .37], [.75, .37], [.5, .5], [.25, .63], [.75, .63], [.25, .88], [.75, .88]],
    10: [[.25, .12], [.75, .12], [.5, .25], [.25, .37], [.75, .37], [.25, .63], [.75, .63], [.5, .75], [.25, .88], [.75, .88]]
  };

  let THREE = null, RAPIER = null;
  let scene = null, camera = null, renderer = null, canvas = null;
  let world = null, eventqueue = null, raycaster = null;

  let open = false, ready = false, booting = false, leaving = false;

  let myid = null;
  const cards = [];
  const bycollider = new Map();
  const anims = [];
  const disposables = [];
  let box = null;

  let hover = null;
  let held = null;
  let press = null;
  let lastmx = 0, lastmy = 0;
  let lastshare = 0;
  let lasttick = 0;
  let lastrender = 0;
  let working = 0;
  let stepacc = 0;
  let flippedat = 0;
  let members = new Set();

  const hand = [];
  const facedata = [];
  let handel = null, handslot = null, dropel = null;
  let handdrag = null;

  const note = (t) => window.debuglog?.('out', 'cards', t);
  const now = () => performance.now();
  const round = (v) => Math.round(v * 1000) / 1000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const suitof = (i) => suitnames[Math.floor(i / 13)];
  const rankof = (i) => i % 13;
  const inkof = (i) => (suitof(i) === 'heart' || suitof(i) === 'diamond' ? redink : blackink);

  const accent = (id) => window.party?.colorfor?.(id) || '#23d18b';


  function yawq(a) {
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
  }

  function facedown(a) {
    return yawq(a).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
  }

  function setcollide(c, on) {
    if (c.collides === on) return;
    c.collides = on;
    try { c.collider.setCollisionGroups(on ? 0xffffffff : 0); } catch {}
  }


  let actx = null;
  let noisebuf = null;
  let slidenode = null;
  let lasttap = 0;

  function audio() {
    if (actx) return actx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    actx = new Ctx();
    return actx;
  }

  function noise(ctx) {
    if (noisebuf && noisebuf.sampleRate === ctx.sampleRate) return noisebuf;
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noisebuf = buf;
    return buf;
  }

  function burst({ freq, freqto, q, type, peak, decay, dur, delay }) {
    const ctx = audio();
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.playbackRate.value = 0.8 + Math.random() * 0.4;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    const t0 = ctx.currentTime + (delay || 0);
    filter.frequency.setValueAtTime(freq, t0);
    if (freqto) filter.frequency.exponentialRampToValueAtTime(freqto, t0 + dur * 0.8);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0006, t0 + decay);

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur);
  }

  function tap(strength, delay) {
    const s = clamp(strength, 0, 1);
    if (s < 0.04) return;
    const t = now();
    if (!delay && t - lasttap < 22) return;
    if (!delay) lasttap = t;
    burst({
      freq: 2600 + Math.random() * 1400, q: 2.2, type: 'bandpass',
      peak: 0.04 + s * 0.3, decay: 0.018 + s * 0.03, dur: 0.08, delay
    });
  }

  function pickupsound() {
    burst({ freq: 3800, q: 3, type: 'bandpass', peak: 0.07, decay: 0.02, dur: 0.06 });
  }

  function flipsound() {
    burst({ freq: 700, freqto: 3200, q: 1.4, type: 'bandpass', peak: 0.22, decay: 0.11, dur: 0.14 });
    burst({ freq: 3000, q: 2.5, type: 'bandpass', peak: 0.12, decay: 0.02, dur: 0.05, delay: 0.1 });
  }

  function swish() {
    burst({ freq: 400, freqto: 2400, q: 0.9, type: 'bandpass', peak: 0.16, decay: 0.3, dur: 0.34 });
  }

  function thock() {
    burst({ freq: 260, q: 1.2, type: 'lowpass', peak: 0.3, decay: 0.08, dur: 0.14 });
  }

  function slideloop(amount) {
    const ctx = audio();
    if (!ctx) return;
    if (!slidenode) {
      const src = ctx.createBufferSource();
      src.buffer = noise(ctx);
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.8;
      filter.frequency.value = 1400;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();
      slidenode = { src, filter, gain };
    }
    const a = clamp(amount / 30, 0, 1);
    slidenode.gain.gain.setTargetAtTime(a * 0.09, ctx.currentTime, 0.05);
    slidenode.filter.frequency.setTargetAtTime(900 + a * 2200, ctx.currentTime, 0.08);
  }

  function stopslide() {
    if (!slidenode) return;
    const { src, gain } = slidenode;
    slidenode = null;
    try { gain.gain.value = 0; src.stop(); } catch {}
  }


  function drawsuit(ctx, suit, cx, cy, cell, flip) {
    const mask = suitmasks[suit];
    const rows = mask.length, cols = mask[0].length;
    const x0 = Math.round(cx - (cols * cell) / 2);
    const y0 = Math.round(cy - (rows * cell) / 2);
    for (let r = 0; r < rows; r++) {
      const row = mask[flip ? rows - 1 - r : r];
      for (let c = 0; c < cols; c++) {
        if (row[c] === 'X') ctx.fillRect(x0 + c * cell, y0 + r * cell, cell, cell);
      }
    }
  }

  let atlas = null;


  function loadatlas() {
    if (atlas) return Promise.resolve(atlas);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => { atlas = img; resolve(img); };
      img.onerror = () => resolve(null);
      img.src = '../assets/cards.png';
    });
  }

  function atlascell(col, row) {
    const c = document.createElement('canvas');
    c.width = atlascw;
    c.height = atlasch;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(atlas, col * atlascw, row * atlasch, atlascw, atlasch, 0, 0, atlascw, atlasch);
    return c;
  }

  function cardface(i) {
    if (atlas) return atlascell(rankof(i), Math.floor(i / 13));
    return facecanvas(i);
  }

  function cardback() {
    if (atlas) return atlascell(0, 4);
    return backcanvas();
  }

  function facecanvas(i) {
    const w = 256, h = 358;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const suit = suitof(i);
    const rank = rankof(i);
    const ink = inkof(i);
    const label = ranks[rank];

    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,.14)';
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, w - 24, h - 24);

    const corner = (flip) => {
      ctx.save();
      if (flip) { ctx.translate(w, h); ctx.rotate(Math.PI); }
      ctx.fillStyle = ink;
      ctx.font = `700 ${label.length > 1 ? 34 : 40}px 'Silkscreen', 'Consolas', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, 36, 22);
      drawsuit(ctx, suit, 36, 90, 4, false);
      ctx.restore();
    };
    corner(false);
    corner(true);

    ctx.fillStyle = ink;

    if (rank === 0) {
      drawsuit(ctx, suit, w / 2, h / 2, suit === 'spade' ? 14 : 12, false);
    } else if (rank >= 10) {
      const tint = ink === redink ? '#fbe2e5' : '#e3e4ef';
      ctx.fillStyle = tint;
      ctx.fillRect(66, 64, 124, 230);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 6;
      ctx.strokeRect(66, 64, 124, 230);

      ctx.fillStyle = '#e8b93a';
      const crown = [[0, 2], [1, 1], [2, 2], [3, 0], [4, 2], [5, 1], [6, 2]];
      crown.forEach(([cx, cy]) => ctx.fillRect(100 + cx * 8, 92 + cy * 8, 8, 24 - cy * 8));
      ctx.fillRect(100, 116, 56, 8);

      ctx.fillStyle = ink;
      ctx.font = `700 92px 'Silkscreen', 'Consolas', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, w / 2, h / 2 + 8);
      drawsuit(ctx, suit, w / 2, 256, 5, false);
    } else {
      const list = pips[rank + 1];
      list.forEach(([fx, fy]) => {
        drawsuit(ctx, suit, 44 + fx * 168, 62 + fy * 234, 5, fy > 0.55);
      });
    }
    return c;
  }

  function backcanvas() {
    const w = 256, h = 358;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#8f1a2a';
    ctx.fillRect(16, 16, w - 32, h - 32);

    const cell = 14;
    for (let y = 16; y < h - 16; y += cell) {
      for (let x = 16; x < w - 16; x += cell) {
        const odd = ((x - 16) / cell + (y - 16) / cell) % 2 === 0;
        ctx.fillStyle = odd ? '#a8233a' : '#7a1422';
        ctx.beginPath();
        ctx.moveTo(x + cell / 2, y + 1);
        ctx.lineTo(x + cell - 1, y + cell / 2);
        ctx.lineTo(x + cell / 2, y + cell - 1);
        ctx.lineTo(x + 1, y + cell / 2);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.strokeStyle = paper;
    ctx.lineWidth = 4;
    ctx.strokeRect(26, 26, w - 52, h - 52);

    ctx.fillStyle = '#1a0c10';
    ctx.fillRect(58, 132, 140, 94);
    ctx.strokeStyle = '#e8b93a';
    ctx.lineWidth = 4;
    ctx.strokeRect(58, 132, 140, 94);

    ctx.fillStyle = '#ffffff';
    ctx.font = `700 40px 'Silkscreen', 'Consolas', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DP!', w / 2, 166);

    ctx.fillStyle = '#e8b93a';
    ['spade', 'heart', 'diamond', 'club'].forEach((s, k) => drawsuit(ctx, s, 88 + k * 27, 206, 2, false));
    return c;
  }

  function boxcanvas(kind) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    c.width = 256;
    c.height = kind === 'lid' ? 346 : 64;

    ctx.fillStyle = '#9c2a33';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#86232b';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
    return c;
  }

  function texture(c, pixel) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (pixel) t.magFilter = THREE.NearestFilter;
    t.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
    disposables.push(t);
    return t;
  }


  function cardmaterial(map, foil) {
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.5, metalness: 0.0 });
    const u = {
      uTime: { value: 0 },
      uHover: { value: 0 },
      uGlow: { value: new THREE.Color(0xffd24a) },
      uFoil: { value: foil ? 1 : 0 },
      uSweep: { value: -2 }
    };
    mat.userData.u = u;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          uniform float uHover;
          uniform vec3 uGlow;
          uniform float uFoil;
          uniform float uSweep;
          vec3 huecolor(float h) {
            return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          }`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          #ifdef USE_MAP
            vec2 cuv = vMapUv;
          #else
            vec2 cuv = vec2(0.5);
          #endif
          vec3 viewdir = normalize(vViewPosition);
          float facing = abs(dot(viewdir, normalize(normal)));
          float fres = pow(1.0 - facing, 2.0);
          if (uFoil > 0.5) {
            float h = fract(cuv.x * 0.9 + cuv.y * 0.7 + viewdir.x * 1.6 + viewdir.y * 1.3 + uTime * 0.04);
            gl_FragColor.rgb += huecolor(h) * (0.09 + fres * 0.55);
          }
          float band = exp(-pow((cuv.x + cuv.y - uSweep) * 6.0, 2.0));
          gl_FragColor.rgb += vec3(1.0, 0.97, 0.9) * band * 0.4;
          float edge = min(min(cuv.x, 1.0 - cuv.x), min(cuv.y, 1.0 - cuv.y));
          float rim = 1.0 - smoothstep(0.0, 0.05, edge);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uGlow, rim * uHover * 0.9);`);
    };
    mat.customProgramCacheKey = () => 'dpcard';
    disposables.push(mat);
    return mat;
  }

  function roundshape() {
    const s = new THREE.Shape();
    const x = -cardw / 2, y = -cardl / 2, w = cardw, h = cardl, r = cardr;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  function cardgeometry() {
    const shape = roundshape();

    const face = new THREE.ShapeGeometry(shape, 6);
    const uv = face.attributes.uv;
    const pos = face.attributes.position;
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, (pos.getX(k) + cardw / 2) / cardw, (pos.getY(k) + cardl / 2) / cardl);
    }
    face.rotateX(-Math.PI / 2);
    face.translate(0, cardt / 2 + 0.0004, 0);

    const back = new THREE.ShapeGeometry(shape, 6);
    const buv = back.attributes.uv;
    const bpos = back.attributes.position;
    for (let k = 0; k < buv.count; k++) {
      buv.setXY(k, 1 - (bpos.getX(k) + cardw / 2) / cardw, 1 - (bpos.getY(k) + cardl / 2) / cardl);
    }
    back.rotateX(Math.PI / 2);
    back.translate(0, -cardt / 2 - 0.0004, 0);

    const edge = new THREE.ExtrudeGeometry(shape, { depth: cardt, bevelEnabled: false, curveSegments: 6 });
    edge.rotateX(-Math.PI / 2);
    edge.translate(0, -cardt / 2, 0);

    disposables.push(face, back, edge);
    return { face, back, edge };
  }



  function build() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 1, 400);
    camera.up.set(0, 0, -1);

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3440, 1.15));

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(7, 40, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -worldw / 2 - 4, right: worldw / 2 + 4, top: worldd / 2 + 4, bottom: -worldd / 2 - 4, near: 5, far: 80 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 5;
    scene.add(key);

    const catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(worldw + 20, worldd + 20),
      new THREE.ShadowMaterial({ opacity: 0.28 })
    );
    catcher.rotation.x = -Math.PI / 2;
    catcher.receiveShadow = true;
    scene.add(catcher);
    disposables.push(catcher.geometry, catcher.material);

    raycaster = new THREE.Raycaster();
    fitcamera();
  }

  function fitcamera() {
    if (!camera) return;
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    const t = Math.tan((fov / 2) * Math.PI / 180);
    const h = Math.max(worldd / 2, worldw / (2 * aspect)) / t;
    camera.position.set(0, h, 0);
    camera.lookAt(0, 0, 0);
    camera.near = Math.max(1, h - 30);
    camera.far = h + 30;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  function onresize() {
    if (!open || !renderer) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
    fitcamera();
    renderhand();
  }


  function buildbounds() {
    const fixed = (hx, hy, hz, x, y, z) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
      const col = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.55).setRestitution(0.05)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body
      );
      bycollider.set(col.handle, { kind: 'bound' });
    };
    fixed(worldw / 2 + 2, 0.5, worldd / 2 + 2, 0, -0.5, 0);
    fixed(worldw / 2 + 2, 4, 0.5, 0, 3.5, -worldd / 2 - 0.5);
    fixed(worldw / 2 + 2, 4, 0.5, 0, 3.5, worldd / 2 + 0.5);
    fixed(0.5, 4, worldd / 2 + 2, -worldw / 2 - 0.5, 3.5, 0);
    fixed(0.5, 4, worldd / 2 + 2, worldw / 2 + 0.5, 3.5, 0);
  }

  function buildcards() {
    const geo = cardgeometry();
    const backtex = texture(cardback(), true);
    const edgemat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7 });
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    disposables.push(edgemat, hidden);

    for (let i = 0; i < count; i++) {
      const rank = rankof(i);
      const facemat = cardmaterial(texture(cardface(i), true), rank === 0 || rank >= 10);
      const backmat = cardmaterial(backtex, false);

      const group = new THREE.Group();
      const face = new THREE.Mesh(geo.face, facemat);
      const back = new THREE.Mesh(geo.back, backmat);
      const edge = new THREE.Mesh(geo.edge, [hidden, edgemat]);
      [face, back, edge].forEach(m => {
        m.castShadow = true;
        m.userData.card = i;
      });
      group.add(face, back, edge);
      group.visible = false;
      scene.add(group);

      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(0, -40 - i, 0)
          .setLinearDamping(0.9)
          .setAngularDamping(2.4)
          .setCcdEnabled(true)
          .setCanSleep(true)
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(cardw / 2 - 0.02, colhalf, cardl / 2 - 0.02)
          .setFriction(0.32)
          .setRestitution(0.02)
          .setDensity(2.2)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body
      );

      const card = {
        i, group, face, back, body, collider,
        mats: [facemat, backmat],
        kin: true, stowed: true, mode: 'stowed', inhand: null, collides: true,
        owner: null, until: 0, anim: null,
        remote: null, wassleep: true,
        hoverv: 0, sweepat: -1, glow: null
      };
      bycollider.set(collider.handle, { kind: 'card', card });
      cards.push(card);
    }
  }

  function buildbox(x, z) {
    const sidetex = texture(boxcanvas('side'), true);
    const lidtex = texture(boxcanvas('lid'), true);
    const redmat = new THREE.MeshStandardMaterial({ color: 0x9c2a33, roughness: 0.6 });
    const sidemat = new THREE.MeshStandardMaterial({ map: sidetex, roughness: 0.55 });
    const inside = new THREE.MeshStandardMaterial({ color: 0x2a0a10, roughness: 0.9, side: THREE.BackSide });
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const lidmat = cardmaterial(lidtex, false);
    lidmat.roughness = 0.4;
    disposables.push(redmat, sidemat, inside, hidden);

    const group = new THREE.Group();
    const basegeo = new THREE.BoxGeometry(boxw, boxh, boxd);
    const innergeo = new THREE.BoxGeometry(boxw - 0.1, boxh - 0.1, boxd - 0.04);
    const lidgeo = new THREE.BoxGeometry(boxw + 0.04, boxh + 0.04, 0.06);
    disposables.push(basegeo, innergeo, lidgeo);

    const base = new THREE.Mesh(basegeo, [sidemat, sidemat, lidmat, redmat, hidden, redmat]);
    base.castShadow = true;
    const inner = new THREE.Mesh(innergeo, inside);

    const hinge = new THREE.Group();
    hinge.position.set(0, boxh / 2 + 0.02, boxd / 2 + 0.03);
    const lid = new THREE.Mesh(lidgeo, [redmat, redmat, redmat, redmat, sidemat, redmat]);
    lid.position.set(0, -boxh / 2 - 0.02, 0);
    lid.castShadow = true;
    hinge.add(lid);

    [base, inner, lid].forEach(m => { m.userData.box = true; });
    group.add(base, inner, hinge);
    scene.add(group);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, boxh / 2, z)
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(boxw / 2, boxh / 2, boxd / 2).setFriction(0.5)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body
    );
    bycollider.set(collider.handle, { kind: 'box' });

    box = {
      group, hinge, body, lidmat, collider,
      x, z, yaw: 0, tilt: 0, lift: 0, lid: 0, scale: 1,
      inbox: true, busy: false,
      owner: null, until: 0,
      remote: null, hoverv: 0
    };
    placebox();
  }

  function boxquat() {
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), box.yaw);
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), box.tilt);
    return qy.multiply(qx);
  }

  function placebox() {
    const q = boxquat();
    const p = new THREE.Vector3(box.x, (boxh / 2) * box.scale + box.lift, box.z);
    box.body.setNextKinematicTranslation(p);
    box.body.setNextKinematicRotation(q);
    box.group.position.copy(p);
    box.group.quaternion.copy(q);
    box.group.scale.setScalar(Math.max(0.001, box.scale));
    box.hinge.rotation.x = -box.lid;
  }

  function limit(x, z, mx, mz) {
    return {
      x: clamp(x, -worldw / 2 + mx, worldw / 2 - mx),
      z: clamp(z, -worldd / 2 + mz, worldd / 2 - mz)
    };
  }

  function deckspot() {
    const dir = box.x > 0 ? -1 : 1;
    return limit(box.x + dir * (boxw / 2 + cardw / 2 + 0.9), box.z, cardw, cardl);
  }


  function setkin(card, on) {
    if (card.kin === on) return;
    card.body.setBodyType(on ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
    card.kin = on;
  }

  function stow(card, who) {
    card.stowed = true;
    card.inhand = who || null;
    card.mode = 'stowed';
    card.anim = null;
    setcollide(card, true);
    card.remote = null;
    setkin(card, true);
    card.body.setTranslation({ x: 0, y: -40 - card.i, z: 0 }, false);
    card.body.setNextKinematicTranslation({ x: 0, y: -40 - card.i, z: 0 });
    card.group.visible = false;
    if (hover === card) sethover(null);
  }

  function unstow(card) {
    if (!card.stowed) return;
    card.stowed = false;
    card.inhand = null;
    card.mode = 'free';
    card.group.visible = true;
  }

  function pose(card) {
    const p = card.body.translation();
    const r = card.body.rotation();
    return {
      p: new THREE.Vector3(p.x, p.y, p.z),
      q: new THREE.Quaternion(r.x, r.y, r.z, r.w)
    };
  }

  function mine(card) {
    return card.owner === myid;
  }

  function claim(list, withbox) {
    const t = now() + authorityms;
    const ids = [];
    list.forEach(c => {
      c.owner = myid;
      c.until = t;
      ids.push(c.i);
    });
    if (withbox) {
      box.owner = myid;
      box.until = t;
    }
    window.party?.broadcast({ t: 'cg', ids, box: !!withbox });
  }


  function setcursor(kind) {
    document.documentElement.style.cursor = kind || '';
  }

  function sethover(target) {
    if (hover === target) return;
    hover = target;
    if (target && target !== box) target.sweepat = now();
    if (!held) setcursor(target ? 'grab' : '');
  }

  function hitat(clientx, clienty) {
    if (!ready || !box) return null;
    const nx = (clientx / window.innerWidth) * 2 - 1;
    const ny = -(clienty / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    const targets = [box.group];
    cards.forEach(c => { if (!c.stowed) targets.push(c.group); });
    const hits = raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      if (h.object.userData.card !== undefined) {
        const c = cards[h.object.userData.card];
        if (c.mode === 'anim' || (c.mode === 'held' && !held)) continue;
        return c;
      }
      if (h.object.userData.box) return box;
    }
    return null;
  }

  function planeat(clientx, clienty, y) {
    const nx = (clientx / window.innerWidth) * 2 - 1;
    const ny = -(clienty / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  }

  function pileof(card) {
    const a = pose(card).p;
    return cards.filter(c => {
      if (c.stowed || c.mode === 'anim') return false;
      const p = pose(c).p;
      return Math.hypot(p.x - a.x, p.z - a.z) < 0.9;
    }).sort((x, y) => pose(x).p.y - pose(y).p.y);
  }

  function busy() {
    return anims.length > 0 || !box || box.busy || working > 0;
  }


  function beginhold(card, shift, clientx, clienty) {
    const list = shift ? pileof(card) : [card];
    if (!list.length) return;
    claim(list, false);

    const anchor = pose(card).p;
    const bottom = Math.min(...list.map(c => pose(c).p.y));
    const top = Math.max(holdy, bottom + 0.9);
    const grab = planeat(clientx, clienty, top) || anchor.clone();

    held = {
      kind: 'cards',
      list,
      anchor,
      grabx: grab.x - anchor.x,
      grabz: grab.z - anchor.z,
      offs: list.map(c => {
        const ps = pose(c);
        return { c, off: ps.p.clone().sub(new THREE.Vector3(anchor.x, bottom, anchor.z)), q: ps.q.clone() };
      }),
      yaw: 0,
      tiltx: 0,
      tiltz: 0,
      pos: new THREE.Vector3(anchor.x, bottom, anchor.z),
      vel: new THREE.Vector3(),
      basey: bottom,
      topy: top,
      lift: 0
    };

    list.forEach(c => {
      c.mode = 'held';
      setkin(c, true);
    });
    setcursor('grabbing');
    showdrop(true);
    pickupsound();
    sendstate(list, true);
  }

  function beginboxhold(clientx, clienty) {
    if (box.busy) return;
    claim([], true);
    const grab = planeat(clientx, clienty, 0);
    held = {
      kind: 'box',
      grabx: grab ? grab.x - box.x : 0,
      grabz: grab ? grab.z - box.z : 0,
      vel: new THREE.Vector3()
    };
    setcursor('grabbing');
    thock();
  }

  function updatehold(dt) {
    if (!held) return;

    if (held.kind === 'box') {
      const hit = planeat(lastmx, lastmy, 0);
      if (hit) {
        const t = limit(hit.x - held.grabx, hit.z - held.grabz, boxd / 2 + 0.2, boxd / 2 + 0.2);
        const k = Math.min(1, dt * 16);
        box.x += (t.x - box.x) * k;
        box.z += (t.z - box.z) * k;
      }
      box.lift += (0.35 - box.lift) * Math.min(1, dt * 10);
      placebox();
      return;
    }

    const hit = planeat(lastmx, lastmy, held.topy);
    const prev = held.pos.clone();
    if (hit) {
      const t = limit(hit.x - held.grabx, hit.z - held.grabz, 1, 1);
      const k = Math.min(1, dt * 22);
      held.pos.x += (t.x - held.pos.x) * k;
      held.pos.z += (t.z - held.pos.z) * k;
    }
    held.lift += (1 - held.lift) * Math.min(1, dt * 12);
    held.pos.y = held.basey + (held.topy - held.basey) * held.lift;

    const inst = held.pos.clone().sub(prev).divideScalar(Math.max(dt, 0.001));
    held.vel.lerp(inst, Math.min(1, dt * 14));

    const wantx = clamp(held.vel.z * 0.018, -0.45, 0.45);
    const wantz = clamp(-held.vel.x * 0.018, -0.45, 0.45);
    held.tiltx += (wantx - held.tiltx) * Math.min(1, dt * 12);
    held.tiltz += (wantz - held.tiltz) * Math.min(1, dt * 12);

    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(held.tiltx, held.yaw, held.tiltz, 'YXZ'));
    held.offs.forEach(({ c, off, q }) => {
      const p = off.clone().applyQuaternion(rot).add(held.pos);
      const r = rot.clone().multiply(q);
      c.body.setNextKinematicTranslation(p);
      c.body.setNextKinematicRotation(r);
      c.until = now() + authorityms;
    });
  }

  function endhold() {
    if (!held) return;
    const h = held;
    held = null;
    setcursor(hover ? 'grab' : '');
    showdrop(false);

    if (h.kind === 'box') {
      const drop = () => {
        if (!box) return;
        box.lift += (0 - box.lift) * 0.35;
        placebox();
        if (box.lift > 0.01 && open) requestAnimationFrame(drop);
        else { box.lift = 0; placebox(); thock(); sendbox(); }
      };
      drop();
      return;
    }

    const v = h.vel.clone();
    if (v.length() > maxthrow) v.setLength(maxthrow);
    const spin = clamp((v.x * 0.15) + (Math.random() - 0.5) * v.length() * 0.08, -6, 6);

    h.list.forEach(c => {
      c.mode = 'free';
      setkin(c, false);
      c.body.setLinvel({ x: v.x * 0.85, y: -1.5, z: v.z * 0.85 }, true);
      c.body.setAngvel({ x: 0, y: h.list.length > 1 ? 0 : spin, z: 0 }, true);
      c.until = now() + authorityms;
      c.wassleep = false;
    });
    sendstate(h.list, true);
  }


  function addanim(a) {
    anims.push(a);
    a.list.forEach(c => {
      c.anim = a;
      c.mode = 'anim';
      setkin(c, true);
      setcollide(c, false);
    });
  }

  function runanims() {
    const t0 = now();
    for (let k = anims.length - 1; k >= 0; k--) {
      const a = anims[k];
      if (t0 < a.start) continue;
      if (!a.began) {
        a.began = true;
        a.onstart?.();
      }
      const t = clamp((t0 - a.start) / a.dur, 0, 1);
      a.frame(t);
      a.list.forEach(c => { c.until = now() + authorityms; });
      if (t >= 1) {
        a.snap?.();
        anims.splice(k, 1);
        a.list.forEach(c => {
          if (c.anim !== a) return;
          c.anim = null;
          if (c.mode === 'anim') c.mode = 'free';
          if (!anims.some(o => o.list.includes(c))) setcollide(c, true);
        });
        a.end?.();
      }
    }
  }

  function moveanim(card, to, toq, start, dur, arc, end, onstart) {
    const from = pose(card);
    const a = {
      list: [card], start, dur, onstart,
      frame(t) {
        if (card.anim !== a) return;
        const e = ease(t);
        const p = from.p.clone().lerp(to, e);
        p.y += Math.sin(Math.PI * t) * arc;
        card.body.setNextKinematicTranslation(p);
        card.body.setNextKinematicRotation(from.q.clone().slerp(toq, e));
      },
      snap() {
        if (card.anim !== a) return;
        card.body.setTranslation(to, false);
        card.body.setRotation(toq, false);
      },
      end
    };
    addanim(a);
  }


  function flip(card, pile) {
    if (!ready) return;
    if (!card || card.stowed || card.mode !== 'free' || busy()) return;
    const list = pile ? pileof(card) : [card];
    if (!list.length) return;
    claim(list, false);

    const poses = list.map(c => pose(c));
    const cx = poses.reduce((s, p) => s + p.p.x, 0) / list.length;
    const cz = poses.reduce((s, p) => s + p.p.z, 0) / list.length;
    const ys = poses.map(p => p.p.y);
    const midy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const center = new THREE.Vector3(cx, midy, cz);

    const top = poses[poses.length - 1];
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(top.q);
    axis.y = 0;
    if (axis.lengthSq() < 1e-4) axis.set(0, 0, 1);
    axis.normalize();

    const dur = 420 + list.length * 6;
    const arc = 1.4 + list.length * 0.02;
    const offs = poses.map(p => ({ off: p.p.clone().sub(center), q: p.q }));

    const job = {
      list, start: now(), dur,
      onstart: flipsound,
      frame(t) {
        const e = ease(t);
        const r = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI * e);
        list.forEach((c, k) => {
          if (c.anim !== job) return;
          const p = offs[k].off.clone().applyQuaternion(r).add(center);
          p.y += Math.sin(Math.PI * t) * arc;
          c.body.setNextKinematicTranslation(p);
          c.body.setNextKinematicRotation(r.clone().multiply(offs[k].q));
        });
      },
      snap() {
        const r = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI);
        list.forEach((c, k) => {
          if (c.anim !== job) return;
          c.body.setTranslation(offs[k].off.clone().applyQuaternion(r).add(center), false);
          c.body.setRotation(r.clone().multiply(offs[k].q), false);
        });
      },
      end() {
        list.forEach(c => {
          setkin(c, false);
          c.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
          c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          c.wassleep = false;
        });
        sendstate(list, true);
        tap(0.5);
      }
    };
    addanim(job);
    sendstate(list, true);
  }

  function recall() {
    const list = cards.filter(c => c.inhand);
    if (!list.length) return [];
    const spot = deckspot();

    list.forEach((c, k) => {
      if (c.inhand === myid) droplocal(c.i);
      c.inhand = null;
      c.stowed = false;
      c.mode = 'free';
      c.group.visible = true;
      setkin(c, true);
      c.body.setTranslation({ x: spot.x, y: 2.2 + k * stackgap, z: spot.z + 4 }, false);
      c.body.setRotation(facedown(0), false);
    });

    window.party?.broadcast({ t: 'chclear', ids: list.map(c => c.i) });
    renderhand();
    return list;
  }

  function gather(then) {
    if (!ready || !box) return;
    if (box.busy || anims.length || box.inbox) return;
    recall();

    const list = cards.filter(c => !c.stowed && (c.mode === 'free' || c.mode === 'remote'));
    if (!list.length) { then?.(); return; }
    claim(list, false);
    working += 1;

    const spot = deckspot();
    const down = facedown(0);
    const stack = list.slice().sort((x, y) => pose(x).p.y - pose(y).p.y);

    swish();
    let left = stack.length;
    stack.forEach((c, k) => {
      c.mode = 'free';
      const to = new THREE.Vector3(spot.x, colhalf + k * stackgap, spot.z);
      moveanim(c, to, down, now() + (stack.length - 1 - k) * 9, 360, 1.6 + k * 0.012, () => {
        left -= 1;
        if (left === 0) settlestack(stack, then);
      }, () => tap(0.18));
    });
  }

  function settle(list) {
    list.forEach(c => {
      c.restat = now();
      setkin(c, false);
      c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      c.wassleep = false;
    });
    sendstate(list, true);
  }

  function settlestack(list, then) {
    working = Math.max(0, working - 1);
    settle(list);
    tap(0.6);
    if (then) setTimeout(then, 140);
  }

  function isstacked(list) {
    if (list.length < 2) return true;
    const ps = list.map(c => pose(c).p);
    const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length;
    const cz = ps.reduce((s, p) => s + p.z, 0) / ps.length;
    return ps.every(p => Math.hypot(p.x - cx, p.z - cz) < 0.3 && p.y < stackgap * (list.length + 8));
  }

  function shuffle() {
    if (!ready || !box) return;
    if (box.busy || anims.length || box.inbox) return;
    const list = cards.filter(c => !c.stowed && c.mode === 'free');
    if (list.length < 2 || cards.some(c => c.inhand) || !isstacked(list)) {
      gather(() => {
        const again = cards.filter(c => !c.stowed && c.mode === 'free');
        if (again.length >= 2 && isstacked(again)) shuffle();
      });
      return;
    }
    claim(list, false);
    working += 1;

    const ps = list.map(c => pose(c).p);
    const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length;
    const cz = ps.reduce((s, p) => s + p.z, 0) / ps.length;

    const deck = list.slice();
    for (let k = deck.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [deck[k], deck[j]] = [deck[j], deck[k]];
    }

    const down = facedown(0);
    const tilt = (s) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI + s);

    const halves = { l: [], r: [] };
    deck.forEach(c => (Math.random() < 0.5 ? halves.l : halves.r).push(c));
    if (!halves.l.length) halves.l.push(halves.r.pop());
    if (!halves.r.length) halves.r.push(halves.l.pop());

    const t0 = now();
    swish();
    let left = deck.length;

    ['l', 'r'].forEach(side => {
      const off = side === 'l' ? -1.85 : 1.85;
      halves[side].forEach((c, j) => {
        const to = new THREE.Vector3(cx + off, 0.35 + j * stackgap, cz);
        moveanim(c, to, tilt(side === 'l' ? -0.14 : 0.14), t0, 230, 0.5, null);
      });
    });

    deck.forEach((c, k) => {
      const to = new THREE.Vector3(cx, colhalf + k * stackgap, cz);
      const start = t0 + 300 + k * 17;
      const fire = () => {
        if (!open || !cards.length) return;
        moveanim(c, to, down, now(), 120, 0.25, () => {
          left -= 1;
          if (left === 0) settlestack(deck, null);
        }, () => tap(0.22 + Math.random() * 0.1));
      };
      setTimeout(fire, Math.max(0, start - now()));
    });
  }

  function mouth() {
    const q = boxquat();
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const p = new THREE.Vector3(box.x, boxh / 2 + box.lift, box.z).addScaledVector(n, boxd / 2 + 0.35);
    return { p, n, q };
  }

  function boxanim(dur, frame, end) {
    const t0 = now();
    const step = () => {
      if (!open || !box) return;
      const t = clamp((now() - t0) / dur, 0, 1);
      frame(t);
      placebox();
      if (t < 1) requestAnimationFrame(step);
      else end?.();
    };
    step();
  }

  function rectsoverlap(a, b) {
    const axes = [a.yaw, b.yaw].flatMap(y => [[Math.cos(y), -Math.sin(y)], [Math.sin(y), Math.cos(y)]]);
    const hw = cardw / 2 - 0.05, hl = cardl / 2 - 0.05;
    const span = (r, ax) => {
      const ux = [Math.cos(r.yaw), -Math.sin(r.yaw)], uz = [Math.sin(r.yaw), Math.cos(r.yaw)];
      const c = r.x * ax[0] + r.z * ax[1];
      const e = Math.abs(ux[0] * ax[0] + ux[1] * ax[1]) * hw + Math.abs(uz[0] * ax[0] + uz[1] * ax[1]) * hl;
      return [c - e, c + e];
    };
    return axes.every(ax => {
      const p = span(a, ax), q = span(b, ax);
      return p[0] < q[1] && q[0] < p[1];
    });
  }

  function whenidle(fn, tries = 0) {
    if (!open || leaving) return;
    if (busy() || held) {
      if (tries < 60) setTimeout(() => whenidle(fn, tries + 1), 100);
      return;
    }
    fn();
  }

  function dump() {
    if (!ready || !box) return;
    if (!box.inbox || box.busy || anims.length || held) return;
    const inbox = cards.filter(c => c.stowed && !c.inhand);
    if (!inbox.length) return;
    claim(inbox, true);
    box.busy = true;
    working += 1;

    let fx = -box.x, fz = -box.z;
    if (Math.hypot(fx, fz) < 3) { fx = 0; fz = 1; }
    const a = Math.atan2(fx, fz);
    const from = box.yaw;
    let turn = a - from;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    thock();

    boxanim(300, (t) => {
      box.yaw = from + turn * ease(t);
      box.lift = Math.sin(Math.PI * t) * 0.4;
    }, () => {
      box.yaw = a;
      sendbox();
      boxanim(200, (t) => { box.lid = ease(t) * 2.2; }, () => {
        thock();
        boxanim(280, (t) => {
          const e = ease(t);
          box.lift = e * 2.0;
          box.tilt = e * 1.25;
        }, () => {
          box.inbox = false;
          sendbox();
          const spill = inbox.slice().sort(() => Math.random() - 0.5);
          const placed = [];
          const lipx = worldw / 2 - cardl / 2 - 0.4;
          const lipz = worldd / 2 - cardl / 2 - 0.4;
          const fwd = new THREE.Vector3(Math.sin(box.yaw), 0, Math.cos(box.yaw));
          const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
          const base = new THREE.Vector3(box.x, 0, box.z).addScaledVector(fwd, boxd / 2);
          const clear = Math.hypot(cardw, cardl) / 2 + 0.15;
          const reach = Math.min(
            9,
            Math.abs(fwd.x) > 1e-3 ? ((fwd.x > 0 ? lipx : -lipx) - base.x) / fwd.x : 99,
            Math.abs(fwd.z) > 1e-3 ? ((fwd.z > 0 ? lipz : -lipz) - base.z) / fwd.z : 99
          );
          const nearbox = (x, z) => {
            const dx = x - box.x, dz = z - box.z;
            const along = dx * fwd.x + dz * fwd.z;
            const across = dx * side.x + dz * side.z;
            return Math.abs(along) < boxd / 2 + clear && Math.abs(across) < boxw / 2 + clear;
          };

          spill.forEach((c, k) => {
            let x = base.x + fwd.x * clear, z = base.z + fwd.z * clear;
            for (let tries = 0; tries < 12; tries++) {
              const dist = clear + Math.pow(Math.random(), 0.8) * Math.max(1, reach - clear);
              const lat = (Math.random() - 0.5) * (5 + dist * 1.6);
              const tx = base.x + fwd.x * dist + side.x * lat;
              const tz = base.z + fwd.z * dist + side.z * lat;
              if (Math.abs(tx) > lipx || Math.abs(tz) > lipz || nearbox(tx, tz)) continue;
              x = tx;
              z = tz;
              break;
            }
            x = clamp(x, -lipx, lipx);
            z = clamp(z, -lipz, lipz);
            const dist = Math.hypot(x - base.x, z - base.z);

            const yaw = (Math.random() - 0.5) * 2.4;
            let layer = -1;
            placed.forEach(o => {
              if (o.layer > layer && rectsoverlap(o, { x, z, yaw })) layer = o.layer;
            });
            layer += 1;
            placed.push({ x, z, yaw, layer });

            const q = Math.random() < 0.18 ? yawq(yaw) : facedown(yaw);
            const to = new THREE.Vector3(x, colhalf + layer * stackgap + 0.002, z);

            setTimeout(() => {
              if (!open || !box) return;
              const m = mouth();
              const across = new THREE.Vector3(1, 0, 0).applyQuaternion(m.q);
              unstow(c);
              c.mode = 'free';
              setkin(c, true);
              c.body.setTranslation(m.p.clone().addScaledVector(across, (Math.random() - 0.5) * 0.6), false);
              c.body.setRotation(m.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)), false);
              c.owner = myid;
              c.until = now() + authorityms;
              moveanim(c, to, q, now(), 330 + dist * 55, 0.7 + Math.random() * 1.3, () => {
                settle([c]);
                if (k % 2 === 0) tap(0.18 + Math.random() * 0.12);
              }, k % 3 === 0 ? () => tap(0.3) : null);
            }, k * 17);
          });

          setTimeout(() => {
            boxanim(420, (t) => {
              const e = ease(t);
              box.lift = 2.0 * (1 - e);
              box.tilt = 1.25 * (1 - e);
              box.lid = 2.2 * (1 - e);
            }, () => {
              box.busy = false;
              working = Math.max(0, working - 1);
              thock();
              sendbox();
              setTimeout(() => whenidle(shuffle), 650);
            });
          }, spill.length * 16 + 220);
        });
      });
    });
  }

  function putaway(then) {
    if (!ready || !box) return;
    if (box.inbox || box.busy || anims.length || held) return;
    recall();
    const list = cards.filter(c => !c.stowed && (c.mode === 'free' || c.mode === 'remote'));
    claim(list, true);
    box.busy = true;

    boxanim(220, (t) => { box.lid = ease(t) * 2.2; }, () => {
      swish();
      const m = mouth();
      const order = list.slice().sort((x, y) => pose(y).p.y - pose(x).p.y);
      let left = order.length;
      const done = () => {
        box.inbox = true;
        boxanim(260, (t) => { box.lid = 2.2 * (1 - ease(t)); }, () => {
          box.busy = false;
          thock();
          sendbox();
          then?.();
        });
        sendbox();
      };
      if (!left) return done();
      order.forEach((c, k) => {
        c.mode = 'free';
        moveanim(c, m.p, m.q, now() + k * 13, 380, 2.0, () => {
          stow(c);
          window.party?.broadcast({ t: 'cst', ids: [c.i] });
          left -= 1;
          if (left === 0) done();
        }, k % 4 === 0 ? () => tap(0.15) : null);
      });
    });
  }


  function pack(c, sleeping) {
    const p = c.body.translation();
    const r = c.body.rotation();
    const v = c.kin ? { x: 0, y: 0, z: 0 } : c.body.linvel();
    const w = c.kin ? { x: 0, y: 0, z: 0 } : c.body.angvel();
    let flags = 0;
    if (c.kin && !c.stowed && c.mode !== 'free') flags |= 1;
    if (sleeping) flags |= 2;
    return [c.i, round(p.x), round(p.y), round(p.z), round(r.x), round(r.y), round(r.z), round(r.w),
      round(v.x), round(v.y), round(v.z), round(w.x), round(w.y), round(w.z), flags];
  }

  function sendstate(list, force, sleeping) {
    const e = list.filter(c => !c.stowed).map(c => pack(c, sleeping));
    if (e.length) window.party?.broadcast({ t: 'cs', e });
  }

  function boxstate() {
    return {
      x: round(box.x), z: round(box.z), yaw: round(box.yaw), tilt: round(box.tilt),
      lift: round(box.lift), lid: round(box.lid), inbox: box.inbox, busy: box.busy
    };
  }

  function sendbox() {
    window.party?.broadcast({ t: 'cb', ...boxstate() });
  }

  function share(t0) {
    if (t0 - lastshare < broadcastms) return;
    lastshare = t0;

    const out = [];
    cards.forEach(c => {
      if (c.stowed || !mine(c)) return;
      if (c.mode === 'held' || c.mode === 'anim') { out.push(pack(c)); return; }
      if (c.kin) return;
      const sleeping = c.body.isSleeping();
      if (!sleeping) {
        out.push(pack(c));
        c.restat = 0;
      } else if (!c.wassleep) {
        out.push(pack(c, true));
        c.restat = t0;
      } else if (c.restat && t0 - c.restat > 700) {
        out.push(pack(c, true));
        c.restat = 0;
      }
      c.wassleep = sleeping;
    });
    if (out.length) window.party?.broadcast({ t: 'cs', e: out });

    if (box.owner === myid && (box.busy || (held && held.kind === 'box'))) sendbox();
  }

  function applystate(from, e) {
    const [i, x, y, z, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz, flags] = e;
    const c = cards[i];
    if (!c) return;
    if (mine(c) && c.until > now()) return;
    if (c.mode === 'held' || c.mode === 'anim') return;

    c.owner = from;
    if (c.stowed) {
      unstow(c);
      c.body.setTranslation({ x, y, z }, true);
      c.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
    }

    if (flags & 1) {
      setkin(c, true);
      setcollide(c, false);
      c.mode = 'remote';
      if (!c.remote || c.remote.p.distanceTo(new THREE.Vector3(x, y, z)) > 0.002) c.remoteat = now();
      c.remote = { p: new THREE.Vector3(x, y, z), q: new THREE.Quaternion(qx, qy, qz, qw) };
      return;
    }

    c.remote = null;
    c.mode = 'free';
    setcollide(c, true);

    if (flags & 2) {
      setkin(c, true);
      c.body.setTranslation({ x, y, z }, false);
      c.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, false);
      c.body.setNextKinematicTranslation({ x, y, z });
      c.body.setNextKinematicRotation({ x: qx, y: qy, z: qz, w: qw });
      c.wassleep = true;
      return;
    }

    setkin(c, false);
    c.body.setTranslation({ x, y, z }, true);
    c.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
    c.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    c.body.setAngvel({ x: wx, y: wy, z: wz }, true);
  }

  function applybox(from, m) {
    if (box.owner === myid && box.until > now()) return;
    if (held && held.kind === 'box') return;
    box.owner = from;
    box.remote = m;
    box.inbox = m.inbox;
    box.busy = m.busy;
  }

  function followremote(dt) {
    const k = Math.min(1, dt * 16);
    cards.forEach(c => {
      if (c.mode !== 'remote' || !c.remote) return;
      const cur = pose(c);
      const p = cur.p.lerp(c.remote.p, k);
      const q = cur.q.slerp(c.remote.q, k);
      c.body.setNextKinematicTranslation(p);
      c.body.setNextKinematicRotation(q);
    });

    if (box.remote && box.owner !== myid) {
      const m = box.remote;
      box.x += (m.x - box.x) * k;
      box.z += (m.z - box.z) * k;
      box.yaw += (m.yaw - box.yaw) * k;
      box.tilt += (m.tilt - box.tilt) * k;
      box.lift += (m.lift - box.lift) * k;
      box.lid += (m.lid - box.lid) * k;
      placebox();
    }
  }

  function snapshot() {
    return {
      box: boxstate(),
      free: cards.filter(c => !c.stowed).map(c => pack(c, c.mode === 'free' && (c.kin || c.body.isSleeping()))),
      hands: cards.filter(c => c.inhand).map(c => [c.i, c.inhand])
    };
  }

  function applysnapshot(from, snap) {
    if (!snap || !box) return;
    Object.assign(box, { x: snap.box.x, z: snap.box.z, yaw: snap.box.yaw, tilt: 0, lift: 0, lid: 0, inbox: snap.box.inbox, busy: false });
    box.owner = from;
    placebox();
    (snap.free || []).forEach(e => applystate(from, e));
    (snap.hands || []).forEach(([i, who]) => { if (cards[i]) stow(cards[i], who); });
  }


  function active(t0) {
    if (held || press || anims.length || hover || handdrag) return true;
    if (box && (box.busy || box.hoverv > 0.01)) return true;
    return cards.some(c => !c.stowed && (c.mode === 'remote' || c.hoverv > 0.01 || (!c.kin && !c.body.isSleeping())));
  }

  function tick(t0) {
    if (!open || !world) return;

    try {
      const dt = lasttick ? Math.min(0.05, (t0 - lasttick) / 1000) : 1 / 60;
      lasttick = t0;

      runanims();
      updatehold(dt);
      followremote(dt);

      stepacc = Math.min(stepacc + dt, stepdt * 8);
      world.timestep = stepdt;
      while (stepacc >= stepdt) {
        world.step(eventqueue);
        stepacc -= stepdt;
      }

      eventqueue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const a = bycollider.get(h1), b = bycollider.get(h2);
        if (!a || !b) return;
        const speed = (x) => {
          if (x.kind !== 'card') return 0;
          const v = x.card.body.linvel();
          return Math.hypot(v.x, v.y, v.z);
        };
        tap(Math.max(speed(a), speed(b)) / 14);
      });

      let slide = 0;
      const time = t0 / 1000;
      const myglow = accent(myid);
      cards.forEach(c => {
        if (c.stowed) return;
        const p = c.body.translation();
        const r = c.body.rotation();
        c.group.position.set(p.x, p.y, p.z);
        c.group.quaternion.set(r.x, r.y, r.z, r.w);

        if (!c.kin && !c.body.isSleeping()) {
          const v = c.body.linvel();
          if (Math.abs(v.y) < 1.2) slide += Math.hypot(v.x, v.z);
        }

        if (p.y < -2 && !c.kin) {
          c.body.setTranslation({ x: 0, y: 3, z: 0 }, true);
          c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }

        const remotemove = c.mode === 'remote' && t0 - (c.remoteat || 0) < 260;
        const want = c === hover && !held ? 1 : (c.mode === 'held' || remotemove ? 1 : 0);
        c.hoverv += (want - c.hoverv) * 0.2;
        if (c.hoverv < 0.001) c.hoverv = 0;
        const glow = c.mode === 'remote' ? accent(c.owner) : myglow;
        const sweep = c.sweepat > 0 ? (t0 - c.sweepat) / 450 * 2.6 - 0.3 : -2;
        c.mats.forEach(m => {
          const u = m.userData.u;
          u.uTime.value = time;
          u.uHover.value = c.hoverv;
          u.uSweep.value = sweep;
          if (c.glow !== glow) u.uGlow.value.set(glow);
        });
        c.glow = glow;

        if (c === hover && !held && c.mode === 'free') c.group.position.y += 0.06 * c.hoverv;
      });
      slideloop(slide);

      const bu = box.lidmat.userData.u;
      box.hoverv += ((hover === box ? 1 : 0) - box.hoverv) * 0.2;
      if (box.hoverv < 0.001) box.hoverv = 0;
      bu.uHover.value = box.hoverv;
      bu.uTime.value = time;
      if (bu.uGlow.value.getHexString() !== myglow.replace('#', '').toLowerCase()) bu.uGlow.value.set(myglow);

      share(t0);
      if (active(t0) || t0 - lastrender > idlerenderms) {
        lastrender = t0;
        renderer.render(scene, camera);
      }
    } catch (err) {
      console.error('[cards] frame error:', err);
    }

    requestAnimationFrame(tick);
  }


  function hitscreen(x, y) {
    if (!open || !ready) return false;
    if (held || press || handdrag) return true;
    return !!hitat(x, y);
  }

  function ondown(e) {
    if (!ready || leaving) return;
    lastmx = e.clientX;
    lastmy = e.clientY;
    if (e.button !== 0) return;
    if (e.target?.closest?.('.menu, .cards-hand, .draw-toast')) return;
    const target = hitat(e.clientX, e.clientY);
    if (!target) return;
    audio()?.resume?.();
    e.stopPropagation();
    e.preventDefault();
    press = { target, x: e.clientX, y: e.clientY, shift: e.shiftKey };
    window.dragging = true;
  }

  function onmove(e) {
    lastmx = e.clientX;
    lastmy = e.clientY;
    if (!ready) return;
    if (handdrag) return movehanddrag(e);
    handel?.classList.toggle('drop', !!held && held.kind === 'cards' && overhand(e.clientX, e.clientY));
    dropel?.classList.toggle('drop', !!held && held.kind === 'cards' && overhand(e.clientX, e.clientY));

    if (press && !held) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > dragpx) {
        const t = press.target;
        press = null;
        if (t === box) beginboxhold(e.clientX, e.clientY);
        else if (t.mode === 'free') beginhold(t, e.shiftKey, e.clientX, e.clientY);
      }
      return;
    }
    if (!held) sethover(hitat(e.clientX, e.clientY));
  }

  function onup(e) {
    const was = !!(press || held);
    press = null;
    if (handdrag) return endhanddrag(e);
    handel?.classList.remove('drop');
    dropel?.classList.remove('drop');
    if (held && held.kind === 'cards' && overhand(lastmx, lastmy)) {
      const list = held.list;
      held = null;
      showdrop(false);
      setcursor(hover ? 'grab' : '');
      tohand(list);
    } else {
      endhold();
    }
    if (was) {
      window.dragging = false;
      window.refreshignore?.();
    }
  }

  function ondbl(e) {
    if (!ready || held || leaving) return;
    const t = hitat(e.clientX, e.clientY);
    if (!t) return;
    e.stopPropagation();
    if (t === box) {
      if (box.inbox) dump();
      else putaway();
    } else flip(t, e.shiftKey);
  }

  function onwheel(e) {
    if (!held || held.kind !== 'cards') return;
    e.preventDefault();
    held.yaw += (e.deltaY > 0 ? -1 : 1) * (Math.PI / 12);
    tap(0.12);
  }

  function onkey(e) {
    if (!ready) return;
    const el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    if (e.key.toLowerCase() === 'f' && hover && hover !== box) flip(hover, e.shiftKey);
  }


  function facepng(i) {
    if (!facedata[i]) facedata[i] = cardface(i).toDataURL();
    return facedata[i];
  }

  function handwidth() {
    return Math.min(handw, window.innerWidth * 0.5);
  }

  function overhand(x, y) {
    return y > window.innerHeight - handzone && Math.abs(x - window.innerWidth / 2) < handwidth() / 2 + 40;
  }

  function droplocal(i) {
    const k = hand.indexOf(i);
    if (k >= 0) hand.splice(k, 1);
  }

  function buildhand() {
    handel = document.createElement('div');
    handel.className = 'cards-hand interactive hidden';
    handslot = document.createElement('div');
    handslot.className = 'cards-handslot';
    handel.appendChild(handslot);
    document.body.appendChild(handel);

    dropel = document.createElement('div');
    dropel.className = 'cards-drop hidden';
    document.body.appendChild(dropel);
    renderhand();
  }

  function showdrop(on) {
    dropel?.classList.toggle('hidden', !on);
    if (!on) dropel?.classList.remove('drop');
  }

  function renderhand() {
    if (!handslot) return;
    const n = hand.length;
    handel.classList.toggle('hidden', n === 0);
    const w = handwidth();
    handel.style.width = `${w.toFixed(0)}px`;
    const cw = 72;
    const avail = Math.min(w - 20, 80 + n * 42);
    const step = n > 1 ? Math.min(44, (avail - cw) / (n - 1)) : 0;
    const spread = n > 1 ? Math.min(4, 36 / (n - 1)) : 0;

    const keep = new Set(hand);
    [...handslot.children].forEach(el => { if (!keep.has(Number(el.dataset.i))) el.remove(); });

    hand.forEach((i, k) => {
      let el = handslot.querySelector(`[data-i="${i}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'cards-handcard entering';
        el.dataset.i = String(i);
        el.style.backgroundImage = `url('${facepng(i)}')`;
        el.addEventListener('pointerdown', (e) => handdown(e, i, el));
        handslot.appendChild(el);
        requestAnimationFrame(() => el.classList.remove('entering'));
      }
      const off = k - (n - 1) / 2;
      el.style.setProperty('--tx', `${(w / 2 + off * step - cw / 2).toFixed(1)}px`);
      el.style.setProperty('--ty', `${(off * off * 0.5).toFixed(1)}px`);
      el.style.setProperty('--rot', `${(off * spread).toFixed(2)}deg`);
      el.style.zIndex = String(10 + k);
    });

    window.refreshignore?.();
  }

  function tohand(list) {
    list.forEach(c => {
      c.mode = 'free';
      c.remote = null;
      stow(c, myid);
      if (!hand.includes(c.i)) hand.push(c.i);
    });
    window.party?.broadcast({ t: 'ch', ids: list.map(c => c.i), on: true });
    pickupsound();
    tap(0.3);
    renderhand();
  }

  function fromhand(i, clientx, clienty) {
    const c = cards[i];
    if (!c) return;
    droplocal(i);
    const hit = planeat(clientx, clienty, 1.3) || new THREE.Vector3(0, 1.3, 0);
    const spot = limit(hit.x, hit.z, 1, 1);
    c.inhand = null;
    c.stowed = false;
    c.mode = 'free';
    c.group.visible = true;
    setkin(c, true);
    setcollide(c, true);
    c.body.setTranslation({ x: spot.x, y: 1.3, z: spot.z }, false);
    c.body.setRotation(yawq(0), false);
    window.party?.broadcast({ t: 'ch', ids: [i], on: false });
    renderhand();
    window.dragging = true;
    beginhold(c, false, clientx, clienty);
  }

  function handdown(e, i, el) {
    if (e.button !== 0 || !ready) return;
    e.stopPropagation();
    e.preventDefault();
    audio()?.resume?.();
    handdrag = { i, el, x: e.clientX, y: e.clientY, moved: false };
    window.dragging = true;
  }

  function movehanddrag(e) {
    const d = handdrag;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true;

    if (!overhand(e.clientX, e.clientY)) {
      handdrag = null;
      d.el.remove();
      fromhand(d.i, e.clientX, e.clientY);
      return;
    }
    d.el.classList.add('dragging');
    const r = handel.getBoundingClientRect();
    d.el.style.transform = `translate(${(e.clientX - r.left - 36).toFixed(1)}px, ${(e.clientY - r.top - 20).toFixed(1)}px) rotate(0deg) scale(1.08)`;
  }

  function endhanddrag(e) {
    const d = handdrag;
    handdrag = null;
    window.dragging = false;
    window.refreshignore?.();
    if (!d.moved) return;
    d.el.classList.remove('dragging');
    d.el.style.transform = '';
    const others = hand.filter(i => i !== d.i);
    const r = handel.getBoundingClientRect();
    const w = r.width;
    const n = hand.length;
    const avail = Math.min(w - 20, 80 + n * 42);
    const step = n > 1 ? Math.min(44, (avail - 72) / (n - 1)) : 1;
    let at = Math.round((e.clientX - r.left - w / 2) / step + (n - 1) / 2);
    at = clamp(at, 0, others.length);
    others.splice(at, 0, d.i);
    hand.splice(0, hand.length, ...others);
    tap(0.15);
    renderhand();
  }


  function screentoworld(x, y) {
    const hit = planeat(x, y, 0) || new THREE.Vector3();
    return limit(hit.x, hit.z, boxd / 2 + 0.2, boxd / 2 + 0.2);
  }

  async function enter(x, y, at, from, snap) {
    if (open || booting) return;
    booting = true;
    note('cards open');

    try {
      await loadatlas();
      await window.engine3d.load();
      THREE = window.engine3d.THREE;
      RAPIER = window.engine3d.RAPIER;

      canvas = document.createElement('canvas');
      canvas.className = 'cards-canvas';
      document.body.appendChild(canvas);

      build();
      world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
      if ('numSolverIterations' in world) world.numSolverIterations = 8;
      eventqueue = new RAPIER.EventQueue(true);
      buildbounds();
      buildcards();

      const spot = at || screentoworld(x ?? window.innerWidth / 2, y ?? window.innerHeight / 2);
      buildbox(spot.x, spot.z);
      buildhand();
    } catch (e) {
      note(`cards failed: ${e.message}`);
      console.error('[cards] boot failed', e);
      booting = false;
      teardown();
      return;
    }

    window.addEventListener('pointerdown', ondown, true);
    window.addEventListener('dblclick', ondbl, true);
    window.addEventListener('wheel', onwheel, { passive: false });
    window.addEventListener('pointermove', onmove);
    window.addEventListener('pointerup', onup);
    window.addEventListener('keydown', onkey);
    window.addEventListener('resize', onresize);

    open = true;
    ready = true;
    booting = false;
    leaving = false;
    lasttick = 0;
    stepacc = 0;

    if (snap) applysnapshot(from, snap);
    else {
      box.scale = 0.2;
      boxanim(260, (t) => { box.scale = 0.2 + 0.8 * ease(t); box.lift = Math.sin(Math.PI * t) * 0.8; }, () => { box.scale = 1; box.lift = 0; placebox(); thock(); });
    }

    window.overlay.setstate?.('Playing cards');
    requestAnimationFrame(tick);
    return { x: box.x, z: box.z };
  }

  function teardown() {
    ready = false;
    open = false;
    held = null;
    press = null;
    hover = null;
    anims.length = 0;
    stopslide();
    setcursor('');
    window.dragging = false;

    window.removeEventListener('pointerdown', ondown, true);
    window.removeEventListener('dblclick', ondbl, true);
    window.removeEventListener('wheel', onwheel);
    window.removeEventListener('pointermove', onmove);
    window.removeEventListener('pointerup', onup);
    window.removeEventListener('keydown', onkey);
    window.removeEventListener('resize', onresize);

    disposables.splice(0).forEach(d => { try { d.dispose(); } catch {} });
    cards.length = 0;
    bycollider.clear();
    box = null;
    try { eventqueue?.free?.(); } catch {}
    try { world?.free?.(); } catch {}
    world = null;
    eventqueue = null;
    working = 0;
    renderer?.dispose();
    renderer = null;
    scene = null;
    camera = null;
    canvas?.remove(); canvas = null;

    handel?.remove(); handel = null; handslot = null;
    dropel?.remove(); dropel = null;
    hand.length = 0;
    handdrag = null;

    window.overlay.setstate?.('');
    window.refreshignore?.();
  }

  function close(broadcast) {
    if (!open || leaving) return;
    leaving = true;
    if (broadcast) window.party?.broadcast({ t: 'cardsclose' });
    hover = null;
    held = null;
    cards.forEach(c => { if (!c.stowed) stow(c); });
    boxanim(fadems, (t) => {
      box.scale = 1 - ease(t);
      box.lift = Math.sin(Math.PI * t) * 0.6;
    }, () => teardown());
  }

  function leave() {
    if (!open || leaving) return;
    if (box.inbox) return close(true);
    whenidle(() => putaway(() => close(true)));
  }


  function under(x, y) {
    if (!ready || !box) return false;
    const nx = (x / window.innerWidth) * 2 - 1;
    const ny = -(y / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    const targets = [];
    cards.forEach(c => { if (!c.stowed) targets.push(c.group); });
    return raycaster.intersectObjects(targets, true).length > 0;
  }

  function contextat(x, y) {
    if (!open || !ready || leaving) return null;
    const t = hitat(x, y);
    if (!t || t !== box) {
      if (!t && !under(x, y)) return null;
      if (t && now() - flippedat > 300) {
        flippedat = now();
        flip(t, false);
      }
      return true;
    }
    audio()?.resume?.();
    if (box.inbox) {
      return [
        { label: 'Unpack', run: () => dump() },
        { label: 'Put away', run: () => leave() }
      ];
    }
    return [
      { label: 'Pack', run: () => whenidle(() => putaway()) },
      { label: 'Shuffle', run: () => whenidle(shuffle) },
      { label: 'Stack', run: () => whenidle(() => gather()) }
    ];
  }

  function request(x, y) {
    if (open) {
      if (box && !box.busy && !held) {
        const spot = screentoworld(x ?? window.innerWidth / 2, y ?? window.innerHeight / 2);
        claim([], true);
        const fromx = box.x, fromz = box.z;
        boxanim(320, (t) => {
          const e = ease(t);
          box.x = fromx + (spot.x - fromx) * e;
          box.z = fromz + (spot.z - fromz) * e;
          box.lift = Math.sin(Math.PI * t) * 1.2;
        }, () => { box.lift = 0; placebox(); thock(); sendbox(); });
      }
      return;
    }
    enter(x, y).then(spot => {
      if (!spot) return;
      box.owner = myid;
      window.party?.broadcast({ t: 'cardsopen', at: spot });
    });
  }


  window.party?.onmessage((from, m) => {
    if (m.t === 'cardsopen') {
      if (open || booting) return;
      enter(null, null, m.at, from, m.snap).then(() => { if (box && !m.snap) box.owner = from; });
      return;
    }
    if (m.t === 'cardsclose') return close(false);
    if (!ready || !world) return;

    if (m.t === 'cg') {
      (m.ids || []).forEach(i => {
        const c = cards[i];
        if (!c || (c.mode === 'held' || c.mode === 'anim')) return;
        c.owner = from;
        c.until = 0;
      });
      if (m.box && !(held && held.kind === 'box')) {
        box.owner = from;
        box.until = 0;
      }
    }
    else if (m.t === 'cs') {
      (m.e || []).forEach(e => applystate(from, e));
    }
    else if (m.t === 'cst') {
      (m.ids || []).forEach(i => { if (cards[i]) stow(cards[i]); });
    }
    else if (m.t === 'ch') {
      (m.ids || []).forEach(i => {
        const c = cards[i];
        if (!c) return;
        const who = m.who || from;
        if (m.on) {
          c.remote = null;
          stow(c, who);
          if (who === myid && !hand.includes(i)) hand.push(i);
        } else if (c.inhand === who) {
          c.inhand = null;
        }
      });
      renderhand();
    }
    else if (m.t === 'chclear') {
      (m.ids || []).forEach(i => {
        const c = cards[i];
        if (!c) return;
        droplocal(i);
        c.inhand = null;
      });
      renderhand();
    }
    else if (m.t === 'cb') {
      applybox(from, m);
    }
  });

  window.overlay.onidentity(({ userid }) => { myid = userid; });

  window.overlay.onroster(({ members: list }) => {
    const set = new Set(list || []);
    const fresh = [...set].filter(id => id !== myid && !members.has(id));
    members = set;
    if (!ready) return;

    const lost = cards.filter(c => c.inhand && c.inhand !== myid && !set.has(c.inhand));
    if (lost.length) {
      const spot = deckspot();
      lost.forEach((c, k) => {
        c.inhand = null;
        c.stowed = false;
        c.mode = 'free';
        c.group.visible = true;
        setkin(c, true);
        c.body.setTranslation({ x: spot.x, y: colhalf + k * stackgap, z: spot.z }, false);
        c.body.setRotation(facedown(0), false);
        setkin(c, false);
        c.wassleep = false;
      });
    }

    const orphans = cards.filter(c => c.owner && c.owner !== myid && !set.has(c.owner));
    if (orphans.length) {
      orphans.forEach(c => {
        if (c.mode === 'remote' || (c.mode === 'free' && c.kin && !c.stowed)) {
          c.mode = 'free';
          c.remote = null;
          setkin(c, false);
          setcollide(c, true);
          c.wassleep = false;
        }
      });
      claim(orphans, box.owner && !set.has(box.owner));
    }

    const keeper = box.owner && set.has(box.owner)
      ? box.owner
      : [...set].filter(id => !fresh.includes(id)).sort()[0];
    if (keeper === myid && fresh.length) {
      const snap = snapshot();
      fresh.forEach(id => window.party?.sendto?.(id, { t: 'cardsopen', at: { x: box.x, z: box.z }, snap }));
    }
  });

  function injectstyle() {
    if (document.getElementById('cards-style')) return;
    const el = document.createElement('style');
    el.id = 'cards-style';
    el.textContent = `
      .cards-canvas {
        position: fixed;
        inset: 0;
        z-index: 246;
        width: 100%;
        height: 100%;
        display: block;
        pointer-events: none;
      }

      .cards-hand {
        position: fixed;
        left: 50%;
        bottom: 16px;
        z-index: 247;
        height: 108px;
        transform: translateX(-50%);
      }

      .cards-handslot {
        position: absolute;
        inset: 0;
      }

      .cards-handcard {
        position: absolute;
        left: 0;
        top: 8px;
        width: 72px;
        height: 98px;
        border-radius: 6px;
        background: #f7f3ea center/100% 100% no-repeat;
        box-shadow: 3px 3px 0 rgba(0, 0, 0, .55);
        image-rendering: pixelated;
        transform-origin: 50% 120%;
        transform: translate(var(--tx), var(--ty)) rotate(var(--rot));
        transition: transform .16s cubic-bezier(.2, .9, .3, 1.2), box-shadow .16s ease, opacity .16s ease;
        cursor: grab;
        touch-action: none;
      }

      .cards-handcard:hover {
        transform: translate(var(--tx), calc(var(--ty) - 30px)) rotate(var(--rot)) scale(1.06);
        box-shadow: 5px 5px 0 rgba(0, 0, 0, .55), 0 0 0 3px var(--green);
        z-index: 60 !important;
      }

      .cards-handcard.entering {
        opacity: 0;
        transform: translate(var(--tx), 60px) rotate(var(--rot));
      }

      .cards-handcard.dragging {
        transition: none;
        cursor: grabbing;
        z-index: 80 !important;
        box-shadow: 6px 6px 0 rgba(0, 0, 0, .55), 0 0 0 3px var(--green);
      }

      .cards-drop {
        position: fixed;
        left: 50%;
        bottom: 0;
        z-index: 245;
        width: min(520px, 50vw);
        height: 150px;
        border: 2px dashed rgba(255, 255, 255, .28);
        border-bottom: none;
        border-radius: 14px 14px 0 0;
        background: rgba(0, 0, 0, .12);
        transform: translateX(-50%);
        pointer-events: none;
        transition: border-color .12s steps(2, end), background .12s steps(2, end);
      }

      .cards-drop.drop {
        border-color: var(--green);
        background: rgba(0, 0, 0, .28);
      }
    `;
    document.head.appendChild(el);
  }

  injectstyle();

  window.hitters = window.hitters || [];
  window.hitters.push(hitscreen);

  window.contexthooks = window.contexthooks || [];
  window.contexthooks.push(contextat);

  window.cards = {
    request,
    close: () => leave(),
    contextat,
    isopen: () => open
  };
})();
