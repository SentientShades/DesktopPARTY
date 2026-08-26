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
    if (window.playerdragging) return;
    document.querySelectorAll(borders).forEach(el => register(el, 'border'));
    document.querySelectorAll(texts).forEach(el => register(el, 'text'));
  }

  let timer = null;
  function debounced() {
    clearTimeout(timer);
    timer = setTimeout(scan, debouncems);
  }

  function tick(now) {
    if (!window.playerdragging) {
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
