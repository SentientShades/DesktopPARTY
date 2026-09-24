(() => {
  const tablex = 10;
  const tablez = 20;
  const railh = 0.55;
  const railthick = 0.6;
  const pocketr = 0.34;
  const ballr = 0.3;
  const ballfriction = 0.2;
  const ballrestitution = 0.92;
  const railrestitution = 0.75;
  const linear_damp = 0.35;
  const angular_damp = 0.15;
  const maxpower = 216;
  const maxdragworld = 3.2;
  const movingeps = 0.03;

  const modelplayfracx = 0.789;
  const modelplayfracz = 0.886;

  const satamount = 1.45;

  const stripepx = 30.0;

  const graymix = 0.85;
  const graydim = 0.55;

  const maxrolldelta = 1.2;

  const pocketholer = 0.60;
  const holer = pocketr * 1.3;
  const holesolid = 0.84;

  const closems = 900;
  const holdms = 1000;
  const partms = 1100;
  const broadcastms = 60;
  const authorityms = 6000;
  const potdropms = 260;

  let THREE = null, RAPIER = null, GLTFLoader = null;
  let scene = null, camera = null, renderer = null, canvas = null;
  let world = null, eventqueue = null;
  let raycaster = null, tableplane = null;
  let tablemodel = null, customtableloaded = false, feltinfo = null;
  let floory = -railh - 0.35;

  let root = null, curtains = null, hud = null, trajsvg = null, trajline = null, trajline2 = null;
  let scorebar = null, teamleftbox = null, teamrightbox = null, scoretext = null, subline = null, closebtn = null;
  let powermeter = null, powerfill = null, turnring = null, winbanner = null;
  let placering = null;
  let lastturnteam = null;
  let celebrated = false;
  let open = false, closing = false;

  const balls = new Map();
  const bycollider = new Map();
  let cuestick = null;

  let myid = null;
  let order = [];
  let teams = { a: [], b: [] };
  let turnidx = 0;
  let assign = { a: null, b: null };
  let ballinhand = false;
  let winner = null;
  let over = false;
  let shooter = null;
  let moving = false;
  let potthisshot = [];

  let aiming = false;
  let aimdirx = 0;
  let aimdirz = 0;
  let aimpower = 0;

  const note = (t) => window.debuglog?.('out', 'pool', t);
  const me = () => myid;
  const myturn = () => open && !winner && !over && order[turnidx] === myid && !moving;
  const authority = () => (moving ? shooter : order[turnidx]);

  function teamof(id) {
    return teams.a.includes(id) ? 'a' : (teams.b.includes(id) ? 'b' : null);
  }

  function woodtexture(THREE) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    const planks = 8;
    for (let i = 0; i < planks; i++) {
      const shade = 92 + ((i * 37) % 30);
      ctx.fillStyle = `rgb(${shade + 30},${shade},${shade - 25})`;
      ctx.fillRect(0, (i * 256) / planks, 256, 256 / planks + 1);
      ctx.strokeStyle = 'rgba(0,0,0,.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, (i * 256) / planks, 256, 256 / planks);
      for (let g = 0; g < 6; g++) {
        ctx.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.08})`;
        ctx.beginPath();
        const y = (i * 256) / planks + Math.random() * (256 / planks);
        ctx.moveTo(0, y);
        ctx.lineTo(256, y + (Math.random() - 0.5) * 6);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 12);
    return tex;
  }

  const ballspecs = {
    0:  { color: '#f5f5f5', stripe: false, number: null },
    1:  { color: '#ffd400', stripe: false, number: 1 },
    2:  { color: '#0040ff', stripe: false, number: 2 },
    3:  { color: '#ff1414', stripe: false, number: 3 },
    4:  { color: '#8b16d6', stripe: false, number: 4 },
    5:  { color: '#ff7a00', stripe: false, number: 5 },
    6:  { color: '#0aa32e', stripe: false, number: 6 },
    7:  { color: '#8f1f14', stripe: false, number: 7 },
    8:  { color: '#0a0a0a', stripe: false, number: 8 },
    9:  { color: '#ffd400', stripe: true,  number: 9 },
    10: { color: '#0040ff', stripe: true,  number: 10 },
    11: { color: '#ff1414', stripe: true,  number: 11 },
    12: { color: '#8b16d6', stripe: true,  number: 12 },
    13: { color: '#ff7a00', stripe: true,  number: 13 },
    14: { color: '#0aa32e', stripe: true,  number: 14 },
    15: { color: '#8f1f14', stripe: true,  number: 15 }
  };

  function balltexture(THREE, spec) {
    const w = 256, h = 128;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, w, h);

    if (spec.stripe) {
      ctx.fillStyle = spec.color;
      ctx.fillRect(0, h * 0.24, w, h * 0.52);
    } else if (spec.number !== null) {
      ctx.fillStyle = spec.color;
      ctx.fillRect(0, 0, w, h);
    }

    if (spec.number !== null) {
      const cx = w / 2, cy = h / 2, r = h * 0.22;
      ctx.fillStyle = '#f2f2f2';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#141414';
      ctx.font = `bold ${Math.floor(r * 1.15)}px 'Consolas', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(spec.number), cx, cy + 1);
    }

    return new THREE.CanvasTexture(c);
  }

  let actx = null;
  let noisebuf = null;

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

  function noiseburst({ freq, q, type, peak, decay, dur }) {
    const ctx = ensureaudio();
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noisebuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + decay);

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + dur);
  }

  function ballclack(strength) {
    const s = Math.max(0, Math.min(1, strength));
    if (s < 0.03) return;
    noiseburst({
      freq: 1900 + (Math.random() - 0.5) * 500 + s * 700, q: 3.2, type: 'bandpass',
      peak: 0.06 + s * 0.5, decay: 0.03 + s * 0.05, dur: 0.15
    });
  }

  function railthud(strength) {
    const s = Math.max(0, Math.min(1, strength));
    if (s < 0.03) return;
    noiseburst({
      freq: 500 + (Math.random() - 0.5) * 150 + s * 250, q: 1.2, type: 'lowpass',
      peak: 0.05 + s * 0.4, decay: 0.06 + s * 0.08, dur: 0.22
    });
  }

  function pocketdrop() {
    noiseburst({ freq: 700, q: 0.9, type: 'lowpass', peak: 0.35, decay: 0.09, dur: 0.2 });
    setTimeout(() => noiseburst({ freq: 220, q: 1.4, type: 'lowpass', peak: 0.22, decay: 0.14, dur: 0.3 }), 90);
  }

  function cuestrike(power) {
    const s = Math.max(0.15, Math.min(1, power));
    noiseburst({
      freq: 2400 + s * 500, q: 4, type: 'bandpass',
      peak: 0.08 + s * 0.35, decay: 0.02, dur: 0.1
    });
  }

  function confetti(cx, cy, count) {
    const colors = ['#ffd400', '#ff3b3b', '#5fe38a', '#4d9fff', '#c774ff', '#ff9d2f'];
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      const size = 5 + Math.random() * 5;
      el.style.cssText = [
        'position:absolute', `left:${cx}px`, `top:${cy}px`,
        `width:${size}px`, `height:${(size * 0.6).toFixed(1)}px`,
        `background:${colors[Math.floor(Math.random() * colors.length)]}`,
        'z-index:245', 'pointer-events:none'
      ].join(';');
      document.body.appendChild(el);

      const angle = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 240;
      const dx = Math.cos(angle) * dist;
      const fally = 280 + Math.random() * 260;
      const spin = (Math.random() - 0.5) * 900;
      const dur = 1300 + Math.random() * 900;

      el.animate([
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${(dx * 0.6).toFixed(0)}px, ${(fally * 0.5).toFixed(0)}px) rotate(${(spin * 0.5).toFixed(0)}deg)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx.toFixed(0)}px, ${fally.toFixed(0)}px) rotate(${spin.toFixed(0)}deg)`, opacity: 0 }
      ], { duration: dur, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });

      setTimeout(() => el.remove(), dur + 50);
    }
  }

  function orthoframe() {
    const w = window.innerWidth, h = window.innerHeight;
    const top = 118, bottom = 30, side = 30;

    const halfx = (tablex / modelplayfracx) / 2 * 1.02;
    const halfz = (tablez / modelplayfracz) / 2 * 1.02;
    const upp = Math.max((halfx * 2) / Math.max(100, h - top - bottom), (halfz * 2) / Math.max(100, w - side * 2));
    const shift = ((top - bottom) / 2) * upp;
    return { left: -(w / 2) * upp, right: (w / 2) * upp, top: (h / 2) * upp + shift, bottom: -(h / 2) * upp + shift };
  }

  function buildscene() {
    scene = new THREE.Scene();

    const f = orthoframe();
    camera = new THREE.OrthographicCamera(f.left, f.right, f.top, f.bottom, 0.1, 100);
    camera.position.set(0, 30, 0);
    camera.up.set(1, 0, 0);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const lamp = new THREE.PointLight(0xfff6e0, 1.7, 55, 1.3);
    lamp.position.set(0, 11, 0);
    scene.add(lamp);
    const side1 = new THREE.DirectionalLight(0xffffff, 0.55);
    side1.position.set(6, 9, 4);
    scene.add(side1);
    const side2 = new THREE.DirectionalLight(0xcfe0ff, 0.4);
    side2.position.set(-6, 9, -4);
    scene.add(side2);

    raycaster = new THREE.Raycaster();
    tableplane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    rollaxis = new THREE.Vector3();
    rollquat = new THREE.Quaternion();

    window.addEventListener('resize', () => {
      if (!open) return;
      const nf = orthoframe();
      camera.left = nf.left;
      camera.right = nf.right;
      camera.top = nf.top;
      camera.bottom = nf.bottom;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  function pocketpositions() {
    const x = tablex / 2, z = tablez / 2;
    return [
      [-x, -z], [x, -z], [-x, 0], [x, 0], [-x, z], [x, z]
    ];
  }

  function buildtable() {
    if (!customtableloaded) {
      const felt = new THREE.Mesh(
        new THREE.PlaneGeometry(tablex, tablez),
        saturatematerial(new THREE.MeshStandardMaterial({ color: 0x0e9c48, roughness: 0.9 }))
      );
      felt.rotation.x = -Math.PI / 2;
      scene.add(felt);
    }

    const railmat = saturatematerial(new THREE.MeshStandardMaterial({ color: 0x8a2c14, roughness: 0.55 }));
    const accentmat = new THREE.MeshStandardMaterial({ color: 0xd9a544, roughness: 0.5 });

    const railcollider = (hx, hz, x, z) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, railh / 2, z));
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, railh / 2, hz)
          .setFriction(0.5).setRestitution(railrestitution),
        body
      );
      bycollider.set(collider.handle, { kind: 'rail' });

      if (customtableloaded) return;

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, railh, hz * 2), railmat);
      mesh.position.set(x, railh / 2, z);
      scene.add(mesh);

      const nose = new THREE.Mesh(new THREE.BoxGeometry(hx * 1.9, 0.04, hz * 1.9), accentmat);
      nose.position.set(x, railh + 0.021, z);
      scene.add(nose);
    };

    const gap = pocketr * 1.15;
    const longseg = (tablez - gap * 3) / 2;

    railcollider(railthick / 2, longseg / 2, -tablex / 2 - railthick / 2, -tablez / 4 - gap / 4);
    railcollider(railthick / 2, longseg / 2, -tablex / 2 - railthick / 2,  tablez / 4 + gap / 4);
    railcollider(railthick / 2, longseg / 2,  tablex / 2 + railthick / 2, -tablez / 4 - gap / 4);
    railcollider(railthick / 2, longseg / 2,  tablex / 2 + railthick / 2,  tablez / 4 + gap / 4);

    const shortseg = tablex - gap * 2;
    railcollider(shortseg / 2, railthick / 2, 0, -tablez / 2 - railthick / 2);
    railcollider(shortseg / 2, railthick / 2, 0,  tablez / 2 + railthick / 2);

    pocketpositions().forEach(([x, z]) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0.05, z));
      const collider = world.createCollider(
        RAPIER.ColliderDesc.ball(pocketr).setSensor(true)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body
      );
      bycollider.set(collider.handle, { kind: 'pocket' });

      if (customtableloaded && feltinfo?.material) {
        const geo = new THREE.CircleGeometry(pocketholer + 0.04, 48);
        const patchmat = saturatematerial(new THREE.MeshStandardMaterial({
          color: feltcolor(feltinfo),
          roughness: feltinfo.material.roughness ?? 0.9,
          metalness: feltinfo.material.metalness ?? 0,
          alphaMap: softtexture(0.8),
          transparent: true,
          depthWrite: false
        }));
        const patch = new THREE.Mesh(geo, patchmat);
        patch.rotation.x = -Math.PI / 2;
        patch.position.set(x, 0.01, z);
        scene.add(patch);
      }

      const hole = new THREE.Mesh(
        new THREE.CircleGeometry(holer, 48),
        new THREE.MeshBasicMaterial({ color: 0x030303, alphaMap: softtexture(holesolid), transparent: true, depthWrite: false })
      );
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(x, 0.014, z);
      scene.add(hole);
    });
  }

  const softtex = new Map();
  const accentu = { value: null };
  let placemat = null;
  let lastaccent = '';

  function softtexture(solid) {
    if (softtex.has(solid)) return softtex.get(solid);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(solid, '#ffffff');
    g.addColorStop(1, '#000000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    softtex.set(solid, tex);
    return tex;
  }

  function feltcolor(info) {
    const m = info.material;
    const out = m.color ? m.color.clone() : new THREE.Color(1, 1, 1);
    const img = m.map?.image;
    if (!img || !img.width) return out;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d');
      const frac = (v) => v - Math.floor(v);
      const u = frac(info.uv.x) * img.width;
      const v = (m.map.flipY ? 1 - frac(info.uv.y) : frac(info.uv.y)) * img.height;
      const span = Math.max(8, Math.min(img.width, img.height) * 0.08);
      g.drawImage(img, u - span / 2, v - span / 2, span, span, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let k = 0; k < d.length; k += 4) {
        if (d[k + 3] < 10) continue;
        r += d[k]; gg += d[k + 1]; b += d[k + 2]; n += 1;
      }
      if (n) out.multiply(new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace));
    } catch {}
    return out;
  }

  async function loadtablemodel() {
    if (!GLTFLoader) {
      note('no GLTFLoader available, using stock table visuals');
      return false;
    }
    try {
      const res = await fetch('../assets/tableel.glb');
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const buf = await res.arrayBuffer();

      const gltf = await new Promise((resolve, reject) => {
        new GLTFLoader().parse(buf, '', resolve, reject);
      });

      const group = gltf.scene;

      const tabletopmesh = group.getObjectByName('Cube');
      const legmesh = group.getObjectByName('Cylinder');
      if (tabletopmesh && legmesh) {
        legmesh.material = tabletopmesh.material;
      } else {
        note('table model missing expected Cube/Cylinder nodes, using as-is');
      }

      const outerx = tablex / modelplayfracx;
      const outerz = tablez / modelplayfracz;

      group.updateMatrixWorld(true);
      const size0 = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
      const needsrotate = size0.x > size0.z;
      if (needsrotate) group.rotation.y = Math.PI / 2;

      const scalex = needsrotate ? outerz / size0.x : outerx / size0.x;
      const scalez = needsrotate ? outerx / size0.z : outerz / size0.z;
      const scaley = (scalex + scalez) / 2;
      group.scale.set(scalex, scaley, scalez);
      group.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      group.position.x -= center.x;
      group.position.z -= center.z;
      group.position.y -= box.max.y;

      group.updateMatrixWorld(true);

      const finalbox = new THREE.Box3().setFromObject(group);
      floory = finalbox.min.y - 0.05;

      const ray = new THREE.Raycaster(new THREE.Vector3(0, 300, 0), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(group, true)[0];
      if (hit?.uv) {
        const mats = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
        feltinfo = { material: mats[hit.face?.materialIndex ?? 0] || mats[0], uv: hit.uv.clone() };
      }

      scene.add(group);
      group.traverse(o => { if (o.isMesh && o.material) saturatematerial(o.material); });
      tablemodel = group;
      note('custom table model loaded');
      return true;
    } catch (e) {
      note(`table model load failed, using stock visuals: ${e.message}`);
      console.error('[pool] table model load failed', e);
      return false;
    }
  }

  const satglsl = `
    vec3 boostsat(vec3 c, float s) {
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      return clamp(mix(vec3(l), c, s), 0.0, 1.0);
    }`;

  function attachhighlightshader(material) {
    const uniforms = { uTime: { value: 0 }, uActive: { value: 0 } };
    material.userData.highlightuniforms = uniforms;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uActive = uniforms.uActive;
      shader.uniforms.uAccent = accentu;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform float uActive;
          uniform vec3 uAccent;
          ${satglsl}`
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          gl_FragColor.rgb = boostsat(gl_FragColor.rgb, ${satamount.toFixed(2)});
          if (uActive > 0.5) {
            float luma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(luma), ${graymix.toFixed(2)}) * ${graydim.toFixed(2)};
            float ang = 0.7;
            float coord = gl_FragCoord.x * cos(ang) - gl_FragCoord.y * sin(ang);
            float stripe = fract((coord + uTime * 34.0) / ${stripepx.toFixed(1)});
            float mask = smoothstep(0.3, 0.45, stripe) - smoothstep(0.55, 0.7, stripe);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uAccent, mask * 0.7);
          }`
        );
    };
    material.needsUpdate = true;
    return material;
  }

  function saturatematerial(material) {
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${satglsl}`)
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          gl_FragColor.rgb = boostsat(gl_FragColor.rgb, ${satamount.toFixed(2)});`
        );
    };
    material.needsUpdate = true;
    return material;
  }

  function ballgrouptype(n) {
    if (n === 0 || n === 8) return null;
    return n <= 7 ? 'solids' : 'stripes';
  }

  function updateballhighlights() {
    const mytype = assign[teamof(myid)];
    balls.forEach(b => {
      const uniforms = b.mesh.material.userData.highlightuniforms;
      if (!uniforms) return;
      const grp = ballgrouptype(b.number);
      uniforms.uActive.value = (mytype && grp && grp !== mytype) ? 1 : 0;
    });
  }

  function makecue() {

    const group = new THREE.Group();
    const length = 7.5;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.13, length, 16),
      new THREE.MeshStandardMaterial({ color: 0xc9a066, roughness: 0.5 })
    );
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -(length / 2 + 0.08);
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, 0.16, 16),
      new THREE.MeshStandardMaterial({ color: 0x2a5fd8, roughness: 0.6 })
    );
    tip.rotation.x = Math.PI / 2;
    tip.position.z = -0.08;
    group.add(shaft, tip);
    group.visible = false;
    scene.add(group);
    return group;
  }

  function ballbody(x, z) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, ballr, z)
        .enabledTranslations(true, false, true)
        .enabledRotations(true, true, true)
        .setLinearDamping(linear_damp)
        .setAngularDamping(angular_damp)
        .setCanSleep(true)
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.ball(ballr)
        .setFriction(ballfriction)
        .setRestitution(ballrestitution)
        .setDensity(1.7)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body
    );
    return { body, collider };
  }

  let shadowtex = null;

  function shadowtexture(THREE) {
    if (shadowtex) return shadowtex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,.55)');
    g.addColorStop(0.7, 'rgba(0,0,0,.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    shadowtex = new THREE.CanvasTexture(c);
    return shadowtex;
  }

  function makeball(number, x, z) {
    const spec = ballspecs[number];
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(ballr, 32, 24),
      attachhighlightshader(new THREE.MeshStandardMaterial({ map: balltexture(THREE, spec), roughness: 0.35 }))
    );
    scene.add(mesh);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(ballr * 2.6, ballr * 2.6),
      new THREE.MeshBasicMaterial({ map: shadowtexture(THREE), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(x, 0.006, z);
    scene.add(shadow);

    const { body, collider } = ballbody(x, z);
    const b = { number, mesh, shadow, body, collider, potted: false, lastx: x, lastz: z };
    balls.set(number, b);
    bycollider.set(collider.handle, { kind: 'ball', ball: b });
    return b;
  }

  function racksetup() {
    const order15 = [1, 9, 2, 10, 8, 3, 11, 14, 4, 12, 5, 13, 6, 15, 7];
    const startz = -tablez * 0.22;
    const spacing = ballr * 2.02;
    let i = 0;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col <= row; col++) {
        const num = order15[i++];
        const x = (col - row / 2) * spacing;
        const z = startz - row * spacing * 0.87;
        makeball(num, x, z);
      }
    }
    makeball(0, 0, tablez * 0.22);
  }

  function faceel(id) {
    const info = window.party.infofor(id) || {};
    const el = document.createElement('div');
    el.className = 'gm-face';
    el.style.borderColor = window.party.colorfor(id);
    if (info.avatar) el.style.backgroundImage = `url('${info.avatar}')`;
    el.title = info.name || id;
    return el;
  }


  function namesof(team) {
    return teams[team].map(id => id === myid ? 'you' : (window.party.infofor(id)?.name || id)).join(' + ') || 'empty';
  }

  function teamplate(side) {
    const plate = document.createElement('div');
    plate.className = `gm-panel gm-team ${side === 'a' ? 'left' : 'right'}`;

    const faces = document.createElement('div');
    faces.className = 'gm-faces';

    const info = document.createElement('div');
    info.className = 'gm-teaminfo';
    const name = document.createElement('span');
    name.className = 'gm-teamname';
    const group = document.createElement('span');
    group.className = 'gm-group';
    info.append(name, group);

    const tray = document.createElement('div');
    tray.className = 'gm-tray';

    plate.append(faces, info, tray);
    return { plate, faces, name, group, tray };
  }

  function makehud() {
    hud = document.createElement('div');
    hud.className = 'gm-top';

    teamleftbox = teamplate('a');
    teamrightbox = teamplate('b');

    const turn = document.createElement('div');
    turn.className = 'gm-panel gm-turnbox';
    scoretext = document.createElement('div');
    scoretext.className = 'gm-turnlabel';
    subline = document.createElement('div');
    subline.className = 'gm-turnsub';
    turn.append(scoretext, subline);

    hud.append(teamleftbox.plate, turn, teamrightbox.plate);
    document.body.appendChild(hud);

    closebtn = document.createElement('button');
    closebtn.className = 'gm-btn gm-close interactive';
    closebtn.title = 'Close for everyone';
    closebtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 4l12 12M16 4L4 16"/></svg><span>close</span>';
    let armed = null;
    closebtn.addEventListener('click', () => {
      if (armed) {
        clearTimeout(armed);
        armed = null;
        close(true);
        return;
      }
      closebtn.classList.add('armed');
      closebtn.querySelector('span').textContent = 'sure?';
      armed = setTimeout(() => {
        armed = null;
        closebtn?.classList.remove('armed');
        if (closebtn) closebtn.querySelector('span').textContent = 'close';
      }, 2400);
    });
    document.body.appendChild(closebtn);

    winbanner = document.createElement('div');
    winbanner.className = 'gm-panel gm-win interactive hidden';
    const title = document.createElement('div');
    title.className = 'gm-wintitle';
    const sub = document.createElement('div');
    sub.className = 'gm-winsub';
    const row = document.createElement('div');
    row.className = 'gm-row';
    const again = document.createElement('button');
    again.className = 'gm-btn go';
    again.textContent = 'Rematch';
    again.addEventListener('click', () => {
      window.party?.broadcast({ t: 'poolrematch' });
      rematch();
    });
    const leave = document.createElement('button');
    leave.className = 'gm-btn';
    leave.textContent = 'Close table';
    leave.addEventListener('click', () => close(true));
    row.append(again, leave);
    winbanner.append(title, sub, row);
    document.body.appendChild(winbanner);
  }

  function ballsleft(type) {
    if (!type) return 7;
    const nums = type === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
    return nums.filter(n => balls.has(n) && !balls.get(n).potted).length;
  }

  function filltray(tray, type) {
    tray.innerHTML = '';
    const nums = type === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : type === 'stripes' ? [9, 10, 11, 12, 13, 14, 15] : [];
    if (!nums.length) {
      for (let k = 0; k < 7; k++) {
        const b = document.createElement('span');
        b.className = 'gm-ball open';
        tray.appendChild(b);
      }
      return;
    }
    nums.forEach(n => {
      const spec = ballspecs[n];
      const b = document.createElement('span');
      b.className = `gm-ball${spec.stripe ? ' stripe' : ''}${balls.get(n)?.potted ? ' gone' : ''}`;
      b.style.setProperty('--ball', spec.color);
      b.textContent = String(n);
      tray.appendChild(b);
    });
  }

  function setplate(t, team) {
    t.faces.innerHTML = '';
    teams[team].forEach(id => t.faces.appendChild(faceel(id)));
    t.name.textContent = namesof(team);
    const type = assign[team];
    t.group.textContent = type ? type : 'open table';
    t.group.dataset.type = type || 'open';
    filltray(t.tray, type);
  }

  function refreshhud() {
    if (!hud) return;

    setplate(teamleftbox, 'a');
    setplate(teamrightbox, 'b');

    const cur = order[turnidx];
    const curteam = teamof(cur);
    const wteam = winner ? teamof(winner) : null;
    const mine = teamof(myid);

    teamleftbox.plate.classList.toggle('active', wteam ? wteam === 'a' : curteam === 'a');
    teamrightbox.plate.classList.toggle('active', wteam ? wteam === 'b' : curteam === 'b');
    teamleftbox.plate.classList.toggle('mine', mine === 'a');
    teamrightbox.plate.classList.toggle('mine', mine === 'b');

    const now = wteam || curteam;
    if (now && now !== lastturnteam) {
      lastturnteam = now;
      const box = now === 'a' ? teamleftbox.plate : teamrightbox.plate;
      box.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(4px)' }, { transform: 'translateY(0)' }],
        { duration: 260, easing: 'steps(3, end)' }
      );
      if (cur === myid && !winner && !over) turnchime();
    }

    const who = cur === myid ? 'your' : `${window.party.infofor(cur)?.name || cur}'s`;
    const mytype = mine ? assign[mine] : null;

    if (winner || over) {
      scoretext.textContent = 'game over';
      subline.textContent = winner ? `${namesof(wteam)} won` : 'no winner';
    } else {
      scoretext.textContent = `${who} shot`;
      scoretext.dataset.mine = cur === myid ? '1' : '';
      if (moving) subline.textContent = 'balls rolling';
      else if (ballinhand) subline.textContent = 'ball in hand';
      else subline.textContent = mytype ? `you have ${mytype}` : 'table is open';
    }

    if ((winner || over) && !celebrated) {
      celebrated = true;
      const mywin = winner && teamof(myid) === wteam;
      winbanner.classList.remove('hidden');
      winbanner.dataset.tone = mywin ? 'go' : 'bad';
      winbanner.querySelector('.gm-wintitle').textContent = winner ? (mywin ? 'you win!' : 'you lose') : 'game over';
      winbanner.querySelector('.gm-winsub').textContent = winner ? (mywin ? 'now brag to your friend' : `${namesof(wteam)} sank the 8`) : '';
      winbanner.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(1.08)', opacity: 1, offset: 0.6 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }
        ],
        { duration: 420, easing: 'cubic-bezier(.22,1.4,.4,1)', fill: 'forwards' }
      );
      if (mywin) {
        confetti(window.innerWidth * 0.3, window.innerHeight * 0.25, 70);
        confetti(window.innerWidth * 0.7, window.innerHeight * 0.25, 70);
      }
    }
    if (!winner && !over) {
      celebrated = false;
      winbanner.classList.add('hidden');
    }
    updateballhighlights();
  }


  function turnchime() {
    const ctx = ensureaudio();
    if (!ctx) return;
    [660, 990].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.08;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.18);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    });
  }

  function rematch() {
    if (!open || !world) return;
    balls.forEach(b => {
      scene.remove(b.mesh);
      scene.remove(b.shadow);
      b.mesh.geometry.dispose();
      b.mesh.material.map?.dispose();
      b.mesh.material.dispose();
      b.shadow.geometry.dispose();
      b.shadow.material.dispose();
      bycollider.delete(b.collider.handle);
      if (!b.gone) { try { world.removeRigidBody(b.body); } catch {} }
    });
    balls.clear();
    racksetup();
    assignteams();
    celebrated = false;
    lastturnteam = null;
    refreshhud();
  }

  function buildtrajectory() {
    trajsvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    trajsvg.setAttribute('width', String(window.innerWidth));
    trajsvg.setAttribute('height', String(window.innerHeight));
    trajsvg.style.cssText = 'position:absolute;left:0;top:0;z-index:201;pointer-events:none;';
    trajline = mktrajline();
    trajline2 = mktrajline();
    trajsvg.append(trajline, trajline2);
    document.body.appendChild(trajsvg);

    powermeter = document.createElement('div');
    powermeter.className = 'gm-power';
    powerfill = document.createElement('div');
    powerfill.className = 'gm-powerfill';
    powermeter.appendChild(powerfill);
    document.body.appendChild(powermeter);
    hidetraj();
  }

  function mktrajline() {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('stroke', '#ffffff');
    l.setAttribute('stroke-width', '5');
    l.setAttribute('stroke-dasharray', '10 8');
    l.setAttribute('opacity', '0');
    return l;
  }


  function hidetraj() {
    trajline?.setAttribute('opacity', '0');
    trajline2?.setAttribute('opacity', '0');
    if (powermeter) powermeter.style.opacity = '0';
  }

  function project(vec3) {
    const v = vec3.clone().project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight
    };
  }

  function buildcurtains() {
    curtains = document.createElement('div');
    curtains.id = 'curtains';
    curtains.innerHTML =
      '<div class="curtain curtainleft"></div>' +
      '<div class="curtain curtainright"></div>';
    document.body.appendChild(curtains);
  }

  function screenpoint(clientx, clienty) {
    const nx = (clientx / window.innerWidth) * 2 - 1;
    const ny = -(clienty / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(tableplane, hit)) return null;
    return hit;
  }

  function anyballmoving() {
    for (const b of balls.values()) {
      if (b.potted) continue;
      const v = b.body.linvel();
      if (Math.hypot(v.x, v.z) > movingeps) return true;
    }
    return false;
  }

  function predicttrajectory(ox, oz, dirx, dirz) {
    const maxdist = 30;
    let bestdist = maxdist;
    let hitball = null;

    balls.forEach(b => {
      if (b.number === 0 || b.potted) return;
      const tox = b.mesh.position.x - ox, toz = b.mesh.position.z - oz;
      const proj = tox * dirx + toz * dirz;
      if (proj <= 0) return;
      const perpx = tox - proj * dirx, perpz = toz - proj * dirz;
      const perp2 = perpx * perpx + perpz * perpz;
      const touch = 2 * ballr;
      const inside = touch * touch - perp2;
      if (inside < 0) return;
      const contactdist = proj - Math.sqrt(inside);
      if (contactdist > 0 && contactdist < bestdist) {
        bestdist = contactdist;
        hitball = b;
      }
    });

    const halfx = tablex / 2 - ballr, halfz = tablez / 2 - ballr;
    let raildist = maxdist;
    if (dirx > 1e-6) raildist = Math.min(raildist, (halfx - ox) / dirx);
    else if (dirx < -1e-6) raildist = Math.min(raildist, (-halfx - ox) / dirx);
    if (dirz > 1e-6) raildist = Math.min(raildist, (halfz - oz) / dirz);
    else if (dirz < -1e-6) raildist = Math.min(raildist, (-halfz - oz) / dirz);
    if (raildist < 0) raildist = maxdist;

    if (hitball && bestdist < raildist) {
      const p1 = { x: ox + dirx * bestdist, z: oz + dirz * bestdist };
      const outx = hitball.mesh.position.x - p1.x, outz = hitball.mesh.position.z - p1.z;
      const outlen = Math.hypot(outx, outz) || 1;
      const p2 = { x: hitball.mesh.position.x + (outx / outlen) * 2.4, z: hitball.mesh.position.z + (outz / outlen) * 2.4 };
      return { p1, p2 };
    }

    const dist = Math.min(raildist, maxdist);
    const p1 = { x: ox + dirx * dist, z: oz + dirz * dist };
    let nx = 0, nz = 0;
    if (Math.abs(p1.x) > halfx - 0.02) nx = Math.sign(p1.x);
    if (Math.abs(p1.z) > halfz - 0.02) nz = Math.sign(p1.z);
    const nlen = Math.hypot(nx, nz) || 1;
    nx /= nlen; nz /= nlen;
    const dot = dirx * nx + dirz * nz;
    const rx = dirx - 2 * dot * nx, rz = dirz - 2 * dot * nz;
    const p2 = { x: p1.x + rx * 3, z: p1.z + rz * 3 };
    return { p1, p2 };
  }

  function startaim(e) {
    if (e.button !== 0) return;
    if (!myturn()) return;
    const cue = balls.get(0);
    if (!cue || cue.potted) return;

    if (ballinhand) {
      const hit = screenpoint(e.clientX, e.clientY);
      if (!hit) return;
      const spot = clampspot(hit.x, hit.z);
      const x = clearspot(spot.x, spot.z) ? spot.x : cue.body.translation().x;
      const z = clearspot(spot.x, spot.z) ? spot.z : cue.body.translation().z;
      setcue(x, z);
      ballinhand = false;
      if (placering) placering.visible = false;
      window.party?.broadcast({ t: 'poolplace', x, z });
      refreshhud();
      return;
    }

    aiming = true;
    cuestick.visible = true;
    updateaim(e.clientX, e.clientY);
  }

  function updateaim(clientx, clienty) {
    if (!aiming) return;
    const cue = balls.get(0);
    const hit = screenpoint(clientx, clienty);
    if (!hit) return;

    const dx = hit.x - cue.mesh.position.x;
    const dz = hit.z - cue.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return;

    aimdirx = dx / dist;
    aimdirz = dz / dist;
    aimpower = Math.max(0, Math.min(1, dist / maxdragworld));

    const pullback = 0.4 + aimpower * 2.8;

    cuestick.position.set(
      cue.mesh.position.x + aimdirx * pullback,
      ballr,
      cue.mesh.position.z + aimdirz * pullback
    );
    cuestick.lookAt(new THREE.Vector3(cue.mesh.position.x, ballr, cue.mesh.position.z));

    const shotdirx = -aimdirx, shotdirz = -aimdirz;
    const path = predicttrajectory(cue.mesh.position.x, cue.mesh.position.z, shotdirx, shotdirz);
    const p0 = project(cue.mesh.position);
    const p1 = project(new THREE.Vector3(path.p1.x, ballr, path.p1.z));
    const p2 = project(new THREE.Vector3(path.p2.x, ballr, path.p2.z));

    trajline.setAttribute('x1', p0.x.toFixed(1));
    trajline.setAttribute('y1', p0.y.toFixed(1));
    trajline.setAttribute('x2', p1.x.toFixed(1));
    trajline.setAttribute('y2', p1.y.toFixed(1));
    trajline.setAttribute('opacity', '0.9');

    trajline2.setAttribute('x1', p1.x.toFixed(1));
    trajline2.setAttribute('y1', p1.y.toFixed(1));
    trajline2.setAttribute('x2', p2.x.toFixed(1));
    trajline2.setAttribute('y2', p2.y.toFixed(1));
    trajline2.setAttribute('opacity', '0.55');

    const meterpos = project(new THREE.Vector3(
      cuestick.position.x, ballr, cuestick.position.z
    ));
    powermeter.style.left = `${meterpos.x.toFixed(1)}px`;
    powermeter.style.top = `${(meterpos.y - 34).toFixed(1)}px`;
    powermeter.style.opacity = '1';
    powerfill.style.width = `${(aimpower * 100).toFixed(0)}%`;
    powerfill.dataset.level = aimpower > 0.75 ? 'hot' : aimpower > 0.4 ? 'mid' : 'low';
  }

  function releaseaim() {
    if (!aiming) return;
    aiming = false;
    cuestick.visible = false;
    hidetraj();

    if (aimpower < 0.04) return;

    const cue = balls.get(0);
    const power = aimpower * maxpower;

    cuestrike(aimpower);
    cue.body.applyImpulse({ x: -aimdirx * power * 0.02, y: 0, z: -aimdirz * power * 0.02 }, true);
    takeshot();
  }

  function clampspot(x, z) {
    return {
      x: Math.max(-tablex / 2 + ballr, Math.min(tablex / 2 - ballr, x)),
      z: Math.max(-tablez / 2 + ballr, Math.min(tablez / 2 - ballr, z))
    };
  }


  function clearspot(x, z) {
    const gap = ballr * 2.04;
    for (const b of balls.values()) {
      if (b.number === 0 || b.potted) continue;
      const p = b.body.translation();
      if (Math.hypot(p.x - x, p.z - z) < gap) return false;
    }
    return true;
  }

  function setcue(x, z) {
    const cue = balls.get(0);
    if (!cue || cue.potted) return;
    cue.body.setTranslation({ x, y: ballr, z }, true);
    cue.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    cue.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    cue.lastx = x;
    cue.lastz = z;
    cue.mesh.position.set(x, ballr, z);
    cue.shadow.position.x = x;
    cue.shadow.position.z = z;
  }

  function takeshot() {
    shooter = myid;
    moving = true;
    potthisshot = [];
    window.party?.broadcast({ t: 'poolshot' });
    refreshhud();
  }

  function groupcleared(type) {
    const nums = type === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
    return nums.every(n => !balls.has(n) || balls.get(n).potted);
  }

  function nextplayer(idx) {
    return (idx + 1) % order.length;
  }

  function resolveshot() {
    broadcaststate();
    moving = false;

    const cuescratched = potthisshot.includes(0);
    let wonow = false;
    let losenow = false;

    if (potthisshot.includes(8)) {
      const mytype = assign[teamof(myid)];
      const cleared = mytype && groupcleared(mytype);
      if (cuescratched || !cleared) losenow = true;
      else wonow = true;
    }

    if (!assign.a && !assign.b) {
      const potnonspecial = potthisshot.find(n => n !== 0 && n !== 8);
      if (potnonspecial !== undefined) {
        const t = potnonspecial <= 7 ? 'solids' : 'stripes';
        const shooterteam = teamof(myid);
        assign[shooterteam] = t;
        assign[shooterteam === 'a' ? 'b' : 'a'] = t === 'solids' ? 'stripes' : 'solids';
      }
    }

    const myteamtype = assign[teamof(myid)];
    const potmine = myteamtype && potthisshot.some(n => n !== 0 && n !== 8 &&
      ((myteamtype === 'solids' && n <= 7) || (myteamtype === 'stripes' && n >= 9)));

    let nextidx = turnidx;
    let handnext = false;

    if (losenow) {
      const opponent = order.find(id => teamof(id) !== teamof(myid));
      if (opponent) winner = opponent;
      else over = true;
    } else if (wonow) {
      winner = myid;
    } else if (cuescratched) {
      handnext = true;
      nextidx = nextplayer(turnidx);
    } else if (!potmine) {
      nextidx = nextplayer(turnidx);
    }

    window.party?.broadcast({
      t: 'poolresolve',
      turnidx: nextidx,
      ballinhand: handnext,
      assign,
      winner,
      over,
      potted: potthisshot
    });

    turnidx = nextidx;
    ballinhand = handnext;
    shooter = null;
    potthisshot = [];

    if (cuescratched) respawncue();
    refreshhud();
  }

  function freespot() {
    const basez = tablez * 0.22;
    for (let ring = 0; ring < 12; ring++) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const r = ring * ballr * 1.2;
        const spot = clampspot(Math.cos(a) * r, basez + Math.sin(a) * r);
        if (clearspot(spot.x, spot.z)) return spot;
        if (ring === 0) break;
      }
    }
    return { x: 0, z: basez };
  }

  function respawncue() {
    const cue = balls.get(0);
    if (!cue) return;

    const spot = freespot();
    handx = spot.x;
    handz = spot.z;
    cue.lastx = spot.x;
    cue.lastz = spot.z;
    if (cue.potted) {
      cue.potted = false;
      cue.mesh.visible = true;
      cue.mesh.scale.setScalar(1);
      cue.mesh.position.set(spot.x, ballr, spot.z);
      cue.shadow.visible = true;
      cue.shadow.material.opacity = 1;
      bycollider.delete(cue.collider.handle);
      world.removeRigidBody(cue.body);
      const { body, collider } = ballbody(spot.x, spot.z);
      cue.body = body;
      cue.collider = collider;
      bycollider.set(collider.handle, { kind: 'ball', ball: cue });
    } else {
      setcue(spot.x, spot.z);
    }
  }

  function potball(b) {
    if (b.potted) return;
    b.potted = true;
    if (shooter === myid) potthisshot.push(b.number);
    pocketdrop();
    refreshhud();
    const start = performance.now();
    const y0 = b.mesh.position.y;
    const anim = () => {
      if (!b.potted) return;
      const t = Math.min(1, (performance.now() - start) / potdropms);
      b.mesh.position.y = y0 - t * 1.4;
      b.mesh.scale.setScalar(1 - t);
      b.shadow.material.opacity = 1 - t;
      if (t < 1) requestAnimationFrame(anim);
      else if (b.potted) {
        b.mesh.visible = false;
        b.shadow.visible = false;
        if (b.number !== 0 && world) {
          b.gone = true;
          world.removeRigidBody(b.body);
          bycollider.delete(b.collider.handle);
        }
      }
    };
    anim();
  }

  function broadcaststate() {
    const list = [];
    const gone = [];
    balls.forEach(b => {
      if (b.potted) { gone.push(b.number); return; }
      const p = b.body.translation();
      const v = b.body.linvel();
      list.push({ n: b.number, x: p.x, z: p.z, vx: v.x, vz: v.z });
    });
    window.party?.broadcast({ t: 'poolstate', balls: list, potted: gone });
  }

  let lastshare = 0;

  let handx = 0, handz = tablez * 0.22;
  let lastmousex = 0, lastmousey = 0;
  let rollaxis = null, rollquat = null;

  function paintaccent() {
    const hex = window.party?.colorfor?.(myid) || '#23d18b';
    if (hex === lastaccent) return;
    lastaccent = hex;
    accentu.value?.set(hex);
    turnring?.material.color.set(hex);
    placemat?.color.set(hex);
  }

  function tick(now) {
    if (!open || !world) return;

    try {
      paintaccent();
      world.step(eventqueue);

      eventqueue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const a = bycollider.get(h1), b = bycollider.get(h2);
        if (!a || !b) return;

        if (a.kind === 'pocket' || b.kind === 'pocket') {
          const ballentry = a.kind === 'ball' ? a : (b.kind === 'ball' ? b : null);
          if (ballentry && shooter === myid) potball(ballentry.ball);
          return;
        }

        const speedof = (entry) => {
          if (entry.kind !== 'ball') return 0;
          const v = entry.ball.body.linvel();
          return Math.hypot(v.x, v.z);
        };
        const speed = Math.max(speedof(a), speedof(b));

        if (a.kind === 'ball' && b.kind === 'ball') {
          ballclack(speed / 7);
        } else if (a.kind === 'rail' || b.kind === 'rail') {
          railthud(speed / 7);
        }
      });

      balls.forEach(b => {
        if (b.potted) return;

        const p = b.body.translation();
        b.mesh.position.set(p.x, p.y, p.z);
        b.shadow.position.x = p.x;
        b.shadow.position.z = p.z;

        const dx = p.x - b.lastx;
        const dz = p.z - b.lastz;
        const dist = Math.hypot(dx, dz);

        if (dist > 1e-6 && dist < maxrolldelta) {
          rollaxis.set(dz, 0, -dx).normalize();
          rollquat.setFromAxisAngle(rollaxis, dist / ballr);
          b.mesh.quaternion.premultiply(rollquat).normalize();
        }
        b.lastx = p.x;
        b.lastz = p.z;

        const hu = b.mesh.material.userData.highlightuniforms;
        if (hu) hu.uTime.value = now / 1000;
      });

      const cue = balls.get(0);

      if (cue && !cue.potted && ballinhand && !moving && !winner && !over) {
        if (myturn()) {
          const hit = screenpoint(lastmousex, lastmousey);
          if (hit) {
            const spot = clampspot(hit.x, hit.z);
            if (clearspot(spot.x, spot.z)) setcue(spot.x, spot.z);
          }

          if (now - lastshare > broadcastms) {
            lastshare = now;
            const p = cue.body.translation();
            window.party?.broadcast({ t: 'poolhand', x: p.x, z: p.z });
          }
        } else {
          const p = cue.body.translation();
          setcue(p.x + (handx - p.x) * 0.35, p.z + (handz - p.z) * 0.35);
        }
        placering.visible = true;
        placering.position.set(cue.mesh.position.x, 0.02, cue.mesh.position.z);
        const ppulse = 1 + Math.sin(now / 190) * 0.12;
        placering.scale.setScalar(ppulse);
      } else if (placering) {
        placering.visible = false;
      }

      if (cue && !cue.potted && myturn() && !aiming && !ballinhand) {
        turnring.visible = true;
        turnring.position.set(cue.mesh.position.x, 0.012, cue.mesh.position.z);
        const pulse = 1 + Math.sin(now / 260) * 0.08;
        turnring.scale.setScalar(pulse);
      } else {
        turnring.visible = false;
      }

      if (shooter === myid && moving && !anyballmoving()) {
        resolveshot();
      }

      if (moving && shooter === myid && now - lastshare > broadcastms) {
        lastshare = now;
        broadcaststate();
      }

      if (aiming) updateaim(lastmousex, lastmousey);

      renderer.render(scene, camera);
    } catch (err) {
      console.error('[pool] frame error:', err);
    }

    requestAnimationFrame(tick);
  }

  function assignteams() {
    order = [me(), ...window.party.peers.keys()].filter(Boolean).sort();
    teams = { a: [], b: [] };
    order.forEach((id, i) => (i % 2 === 0 ? teams.a : teams.b).push(id));
    turnidx = 0;
    assign = { a: null, b: null };
    winner = null;
    over = false;
    ballinhand = false;
    moving = false;
    shooter = null;
    aiming = false;
    potthisshot = [];
    handx = 0;
    handz = tablez * 0.22;
  }

  function onmove(e) {
    lastmousex = e.clientX;
    lastmousey = e.clientY;
  }

  async function enter() {
    if (open) return;
    open = true;
    note('pool open');

    window.menu?.close();
    if (window.theater?.isopen?.()) window.theater.close();

    buildcurtains();
    void curtains.offsetWidth;
    curtains.classList.add('shut');
    await new Promise(r => setTimeout(r, closems + holdms));

    assignteams();

    root = document.createElement('div');
    root.id = 'pool-root';
    root.className = 'interactive';
    root.style.cssText = 'position:fixed;inset:0;z-index:200;background:radial-gradient(ellipse at 50% 55%, #17110e 0%, #080606 58%, #020202 100%);';
    document.body.appendChild(root);

    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    root.appendChild(canvas);

    await window.engine3d.load();
    THREE = window.engine3d.THREE;
    RAPIER = window.engine3d.RAPIER;
    GLTFLoader = window.engine3d.GLTFLoader;

    buildscene();
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    eventqueue = new RAPIER.EventQueue(true);
    accentu.value = new THREE.Color(window.party?.colorfor?.(myid) || '#23d18b');
    lastaccent = '';
    customtableloaded = await loadtablemodel();
    buildtable();
    racksetup();
    cuestick = makecue();
    turnring = new THREE.Mesh(
      new THREE.RingGeometry(ballr * 1.5, ballr * 1.9, 32),
      new THREE.MeshBasicMaterial({ color: 0x5fe38a, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    turnring.rotation.x = -Math.PI / 2;
    turnring.visible = false;
    scene.add(turnring);

    placering = new THREE.Group();
    const placeouter = new THREE.Mesh(
      new THREE.RingGeometry(ballr * 2.1, ballr * 2.5, 40),
      new THREE.MeshBasicMaterial({ color: 0xffc23b, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    placemat = placeouter.material;
    placeouter.rotation.x = -Math.PI / 2;
    const placeinner = new THREE.Mesh(
      new THREE.RingGeometry(ballr * 1.15, ballr * 1.3, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    placeinner.rotation.x = -Math.PI / 2;
    const placeghost = new THREE.Mesh(
      new THREE.SphereGeometry(ballr, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false })
    );
    placeghost.position.y = ballr - 0.02;
    placering.add(placeouter, placeinner, placeghost);
    placering.visible = false;
    scene.add(placering);

    makehud();
    buildtrajectory();
    refreshhud();

    root.addEventListener('pointerdown', startaim);
    window.addEventListener('pointermove', onmove);
    window.addEventListener('pointerup', releaseaim);

    window.overlay.menuactive(true);
    window.refreshignore?.();

    curtains.classList.add('open');
    setTimeout(() => { curtains?.remove(); curtains = null; }, partms);

    requestAnimationFrame(tick);
  }

  async function close(broadcast) {
    if (!open || closing) return;
    closing = true;

    if (broadcast) window.party?.broadcast({ t: 'poolclose' });

    buildcurtains();
    void curtains.offsetWidth;
    curtains.classList.add('shut');
    await new Promise(r => setTimeout(r, closems + 250));

    open = false;
    window.removeEventListener('pointermove', onmove);
    window.removeEventListener('pointerup', releaseaim);

    balls.forEach(b => {
      b.mesh.geometry.dispose();
      b.mesh.material.map?.dispose();
      b.mesh.material.dispose();
      b.shadow.geometry.dispose();
      b.shadow.material.dispose();
    });
    balls.clear();
    bycollider.clear();
    world = null;
    moving = false;
    shooter = null;
    ballinhand = false;
    aiming = false;
    renderer?.dispose();
    renderer = null;
    eventqueue = null;
    tablemodel = null;
    customtableloaded = false;
    feltinfo = null;
    placemat = null;
    floory = -railh - 0.35;

    root?.remove(); root = null;
    hud?.remove(); hud = null;
    closebtn?.remove(); closebtn = null;
    trajline = null;
    trajline2 = null;
    winbanner?.remove(); winbanner = null;
    celebrated = false;
    over = false;
    lastturnteam = null;
    trajsvg?.remove(); trajsvg = null;
    powermeter?.remove(); powermeter = null; powerfill = null;
    turnring?.geometry.dispose();
    turnring?.material.dispose();
    turnring = null;
    placering?.children.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    placering = null;

    window.overlay.menuactive(false);
    window.refreshignore?.();

    curtains?.classList.add('open');
    const going = curtains;
    setTimeout(() => going?.remove(), partms);
    curtains = null;
    closing = false;
  }

  window.party?.onmessage((from, m) => {
    if (m.t === 'poolopen') enter();
    else if (m.t === 'poolclose') close(false);
    else if (m.t === 'poolrematch') rematch();
    else if (!open || !world) return;
    else if (m.t === 'poolshot') {
      shooter = from;
      moving = true;
      ballinhand = false;
      aiming = false;
      if (cuestick) cuestick.visible = false;
      refreshhud();
    }
    else if (m.t === 'poolstate') {
      if (from !== authority()) return;
      (m.potted || []).forEach(n => {
        const b = balls.get(n);
        if (b && !b.potted) potball(b);
      });
      m.balls.forEach(bs => {
        const b = balls.get(bs.n);
        if (!b || b.potted) return;
        b.body.setTranslation({ x: bs.x, y: ballr, z: bs.z }, true);
        b.body.setLinvel({ x: bs.vx, y: 0, z: bs.vz }, true);
      });
    }
    else if (m.t === 'poolhand') {
      if (from !== authority() || !ballinhand) return;
      handx = m.x;
      handz = m.z;
    }
    else if (m.t === 'poolplace') {
      if (from !== authority()) return;
      handx = m.x;
      handz = m.z;
      setcue(m.x, m.z);
      ballinhand = false;
      if (placering) placering.visible = false;
      refreshhud();
    }
    else if (m.t === 'poolresolve') {
      if (shooter && from !== shooter) return;
      (m.potted || []).forEach(n => {
        const b = balls.get(n);
        if (b && !b.potted) potball(b);
      });
      moving = false;
      shooter = null;
      if ((m.potted || []).includes(0)) respawncue();
      turnidx = m.turnidx;
      ballinhand = m.ballinhand;
      assign = m.assign;
      winner = m.winner;
      over = m.over;
      refreshhud();
    }
  });

  window.overlay.onidentity(({ userid }) => { myid = userid; });

  window.overlay.onroster(() => {
    if (open) refreshhud();
  });

  window.vote?.on('pool', (payload, id, owner) => {
    if (open) return;
    if ((owner || me()) === me()) window.party?.broadcast({ t: 'poolopen' });
    enter();
  });

  window.pool = {
    request() {
      if (open) return;
      window.vote.start('pool', { name: '8 Ball' });
    },
    close,
    isopen: () => open
  };
})();