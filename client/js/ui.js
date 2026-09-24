
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
      queue.push(opts); // just wait bro fr fr
      return null;
    }
    visible++;

    const { el, close } = build(opts);
    stack.appendChild(el);

    void el.offsetWidth; /// force
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
    const over = (!!el && el.closest('.interactive') !== null) || (window.hitters || []).some(fn => {
      try { return fn(lastx, lasty); } catch { return false; }
    });
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
