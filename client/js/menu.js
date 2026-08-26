(() => {
  const root = document.createElement('div');
  root.id = 'menuroot';
  document.body.appendChild(root);

  const open = [];
  let target = null;

  function active() {
    return open.length > 0;
  }

  function flag(on) {
    window.menuopen = on;
    window.overlay?.menuactive?.(on);
    window.refreshignore?.();
  }

  function clear(depth) {
    while (open.length > depth) open.pop().remove();
  }

  function close() {
    clear(0);
    target = null;
    flag(false);
  }

  function place(el, x, y) {
    el.style.visibility = 'hidden';
    root.appendChild(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const px = Math.max(4, Math.min(window.innerWidth - w - 4, x));
    const py = Math.max(4, Math.min(window.innerHeight - h - 4, y));
    el.style.transform = `translate(${px}px, ${py}px)`;
    el.style.visibility = '';
    return { x: px, y: py, w, h };
  }

  function build(items, x, y, depth) {
    clear(depth);

    const el = document.createElement('div');
    el.className = 'menu interactive';

    items.forEach(item => {
      if (item.sep) {
        const line = document.createElement('div');
        line.className = 'menusep';
        el.appendChild(line);
        return;
      }

      const button = document.createElement('button');
      button.className = 'menuitem' + (item.danger ? ' danger' : '');

      const left = document.createElement('span');
      left.textContent = item.label;

      if (item.glyph) {
        const mark = document.createElement('span');
        mark.className = 'menuglyph';
        mark.textContent = item.glyph;
        button.appendChild(mark);
      }
      button.appendChild(left);

      if (item.children) {
        const arrow = document.createElement('span');
        arrow.className = 'menuarrow';
        arrow.textContent = '▸';
        button.appendChild(arrow);
      }

      button.addEventListener('pointerenter', () => {
        el.querySelectorAll('.menuitem.open').forEach(b => b.classList.remove('open'));
        if (!item.children) { clear(depth + 1); return; }
        button.classList.add('open');
        const box = button.getBoundingClientRect();
        build(item.children, box.right - 4, box.top - 5, depth + 1);
      });

      button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.children) return;
        item.run?.();
        close();
      });

      el.appendChild(button);
    });

    place(el, x, y);
    open[depth] = el;
    return el;
  }

  function worldmenu(x, y) {
    const shapes = [
      { label: 'Box', glyph: '■', shape: 'box' },
      { label: 'Ball', glyph: '●', shape: 'ball' },
      { label: 'Crate', glyph: '▬', shape: 'crate' },
      { label: 'Triangle', glyph: '▲', shape: 'triangle' }
    ].map(s => ({
      label: s.label,
      glyph: s.glyph,
      run: () => window.physics?.spawn(s.shape, x, y)
    }));

    shapes.push({ sep: true });
    shapes.push({ label: 'Clear mine', run: () => window.physics?.clearmine() });

    return [
      { label: 'Add', children: shapes },
      { label: 'Draw', run: () => window.draw?.toggle() },
      //{ label: 'Debug', glyph: '', run: () => window.debugpanel?.toggle() },
      {
        label: 'Activities',
        children: [
          { label: 'Browser', glyph: '', run: () => window.browser?.toggle() },
         // { label: 'Theater', glyph: '', run: () => window.theater?.request() }
        ]
      }
    ];
  }

  function objectmenu(o) {
    return [
      {
        label: o.frozen ? 'Unfreeze' : 'Freeze',
        run: () => window.physics?.freeze(o, !o.frozen)
      },
      {
        label: 'Resize',
        run: () => window.physics?.beginresize()
      },
      { sep: true },
      {
        label: 'Delete',
        danger: true,
        run: () => window.physics?.destroy(o)
      }
    ];
  }

  function show(x, y) {
    const under = document.elementFromPoint(x, y);
    if (under?.closest?.('.browser-card')) return;
    if (under?.closest?.('.th-screen')) return;
    if (under?.closest?.('.menu')) return;

    close();
    flag(true);

    const hit = window.physics?.pick?.(x, y);
    if (hit) {
      target = hit;
      window.physics.select(hit);
      build(objectmenu(hit), x, y, 0);
    } else {
      window.physics?.deselect?.();
      build(worldmenu(x, y), x, y, 0);
    }
  }

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    show(e.clientX, e.clientY);
  });

  window.overlay?.onmenu?.(({ x, y }) => show(x, y));

  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('.menu')) return;
    if (!active()) return;

    const keep = e.target.closest?.('.axis') || (target && e.target === target.el);
    close();
    if (!keep) window.physics?.deselect?.();
  }, true);

  window.addEventListener('blur', close);
  window.addEventListener('resize', close);

  window.menu = { show, close, isopen: active };
})();
