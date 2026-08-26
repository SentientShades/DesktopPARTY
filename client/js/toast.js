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

    const wrap = document.createElement('div');
    wrap.className = 'avatar-wrap';
    const img = document.createElement('img');
    img.className = 'avatar';
    img.src = opts.avatar || '../assets/pfp.jpg';
    img.alt = '';
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    wrap.append(img, dot);

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

    el.append(wrap, body, art, close);
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
