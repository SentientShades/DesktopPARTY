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
