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
      ? 'Drawing — press Esc to stop'
      : 'Pick the pen to draw anywhere on screen';
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
    grab = { x: e.clientX - box.left, y: e.clientY - box.top };
    try { grip.setPointerCapture(e.pointerId); } catch {}
  });

  grip.addEventListener('pointermove', (e) => {
    if (!held) return;
    place(e.clientX - grab.x, e.clientY - grab.y);
  });

  const release = () => { held = false; };
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
