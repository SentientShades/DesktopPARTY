// ---- toast notifications ----
(() => {
  const maxvisible = 4;
  const defaultms = 6000;
  const exitms = 220;

  const stack = document.getElementById('toast-stack');
  const queue = [];
  let visible = 0;

  function build(opts) {
    const el = document.createElement('div');
    el.className = 'toast interactive entering';
    el.dataset.status = opts.status || 'online';

    if (!opts.noavatar) {
      const wrap = document.createElement('div');
      wrap.className = 'avatar-wrap';
      const img = document.createElement('img');
      img.className = 'avatar';
      img.src = opts.avatar || '../assets/pfp.jpg';
      img.alt = '';
      const dot = document.createElement('span');
      dot.className = 'status-dot';
      wrap.append(img, dot);
      el.appendChild(wrap);
    } else {
      el.classList.add('no-avatar');
    }

    const body = document.createElement('div');
    body.className = 'toast-body';
    const name = document.createElement('span');
    name.className = 'toast-name';
    name.textContent = opts.name || 'Unknown';
    const sub = document.createElement('span');
    sub.className = 'toast-sub';
    sub.textContent = opts.activity || '';
    body.append(name, sub);

    const art = document.createElement('div');
    art.className = 'toast-art';
    if (opts.art) art.style.setProperty('--art', `url('${opts.art}')`);

    const close = document.createElement('button');
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">' +
      '<path d="M3 3l10 10M13 3L3 13"/></svg>';

    el.append(body, art, close);
    return { el, close };
  }

  function show(opts = {}) {
    if (visible >= maxvisible) {
      queue.push(opts);
      return null;
    }
    visible++;

    const { el, close } = build(opts);
    stack.appendChild(el);

    void el.offsetWidth;
    el.classList.remove('entering');

    const life = opts.duration ?? defaultms;
    let timer = null;
    let left = life;
    let began = 0;

    const begin = () => {
      if (life <= 0) return;
      began = Date.now();
      timer = setTimeout(dismiss, left);
    };
    const pause = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      left -= Date.now() - began;
    };

    let gone = false;
    function dismiss() {
      if (gone) return;
      gone = true;
      clearTimeout(timer);

      el.style.height = `${el.offsetHeight}px`;
      void el.offsetWidth;
      el.classList.add('leaving');

      setTimeout(() => {
        el.remove();
        visible--;
        if (queue.length) show(queue.shift());
      }, exitms);
    }

    el.addEventListener('mouseenter', pause);
    el.addEventListener('mouseleave', () => { began = Date.now(); begin(); });
    close.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });

    if (opts.id) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        window.overlay?.ontoastclick?.(opts.id);
        dismiss();
      });
    }

    begin();
    return { dismiss, el };
  }

  function clearall() {
    queue.length = 0;
    stack.querySelectorAll('.toast').forEach(t => {
      t.querySelector('.toast-close')?.click();
    });
  }

  window.toasts = { show, clearall };

  window.overlay?.ontoast?.(show);
})();

// ---- overlay click-through + escape handling ----
(() => {
  let ignoring = null;
  let lastx = 0;
  let lasty = 0;

  function apply(next) {
    if (next === ignoring) return;
    ignoring = next;
    window.overlay.setignoremouse(next);
  }

  function evaluate() {
    if (window.drawmode || window.dragging || window.menuopen) {
      apply(false);
      return;
    }

    const el = document.elementFromPoint(lastx, lasty);
    const over = !!el && el.closest('.interactive') !== null;
    apply(!over);
  }

  function release() {
    if (window.draw?.isarmed?.()) {
      window.draw.disarm();
      window.refreshignore();
      return;
    }

    window.menu?.close();
    window.physics?.deselect?.();
    window.draw?.setvisible(false);
    window.menuopen = false;
    window.dragging = false;
    ignoring = true;
    window.overlay.release();
  }

  window.addEventListener('mousemove', (e) => {
    lastx = e.clientX;
    lasty = e.clientY;
    evaluate();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    release();
  });

  window.refreshignore = () => {
    ignoring = null;
    evaluate();
  };
  window.release = release;
})();

// ---- squiggly hand-drawn look ----
(() => {
  const borders = [
    '.toast:not(.entering):not(.leaving)', '.list', '.host-info',
    '.banner', '.modal-box', '.draw-toast', '.menu', '.me-bar',
    '.avatar-preview', '.brand-mark'
  ].join(', ');

  const texts = [
    '.tool', '.toggle', '.custom-swatch', '.accent-preview',
    '.avatar-sm', '.me-avatar', '.pp-face',
    'input[type="text"]', 'button', '.pill'
  ].join(', ');

  const flipms = 220;
  const count = 10;
  const borderoffset = 0.5;
  const textoffset = 0.5;
  const debouncems = 300;

  function bank(prefix, scale, freq) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    for (let i = 0; i < count; i++) {
      const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
      filter.setAttribute('id', `${prefix}-${i}`);
      filter.setAttribute('x', '-10%');
      filter.setAttribute('y', '-10%');
      filter.setAttribute('width', '120%');
      filter.setAttribute('height', '120%');

      const noise = document.createElementNS('http://www.w3.org/2000/svg', 'feTurbulence');
      noise.setAttribute('type', 'fractalNoise');
      noise.setAttribute('baseFrequency', (freq[0] + Math.random() * (freq[1] - freq[0])).toFixed(4));
      noise.setAttribute('numOctaves', '2');
      noise.setAttribute('seed', String(i * 7 + 1));
      noise.setAttribute('result', 'noise');

      const shift = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
      shift.setAttribute('in', 'SourceGraphic');
      shift.setAttribute('in2', 'noise');
      shift.setAttribute('scale', String(scale[0] + Math.random() * (scale[1] - scale[0])));
      shift.setAttribute('xChannelSelector', 'R');
      shift.setAttribute('yChannelSelector', 'G');

      filter.append(noise, shift);
      defs.appendChild(filter);
    }

    svg.appendChild(defs);
    document.body.appendChild(svg);
  }

  bank('squiggly-border', [1, 2.2], [0.008, 0.014]);
  bank('squiggly-text', [0.3, 0.7], [0.006, 0.01]);

  const items = [];

  function roll(skip) {
    let i = Math.floor(Math.random() * count);
    if (count > 1) {
      while (i === skip) i = Math.floor(Math.random() * count);
    }
    return i;
  }

  function nudge(max) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * max;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  }

  function register(el, kind) {
    if (el.wobbled) return;
    el.wobbled = true;

    const prefix = kind === 'border' ? 'squiggly-border' : 'squiggly-text';
    const max = kind === 'border' ? borderoffset : textoffset;

    const current = roll(-1);
    items.push({
      el,
      prefix,
      max,
      index: current,
      offset: Math.random() * flipms,
      flip: 0
    });
    el.style.filter = `url(#${prefix}-${current})`;
  }

  function scan() {
    if (window.dragging) return;
    document.querySelectorAll(borders).forEach(el => register(el, 'border'));
    document.querySelectorAll(texts).forEach(el => register(el, 'text'));
  }

  let timer = null;
  function debounced() {
    clearTimeout(timer);
    timer = setTimeout(scan, debouncems);
  }

  function tick(now) {
    if (!window.dragging) {
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (!document.body.contains(item.el)) { items.splice(i, 1); continue; }

        const cycle = Math.floor((now + item.offset) / flipms);
        if (cycle !== item.flip) {
          item.flip = cycle;
          item.index = roll(item.index);
          item.el.style.filter = `url(#${item.prefix}-${item.index})`;

          const off = nudge(item.max);
          item.el.style.translate = `${off.x.toFixed(2)}px ${off.y.toFixed(2)}px`;
        }
      }
    }
    requestAnimationFrame(tick);
  }

  const observer = new MutationObserver(debounced);
  observer.observe(document.body, { childList: true, subtree: true });

  scan();
  requestAnimationFrame(tick);
})();
