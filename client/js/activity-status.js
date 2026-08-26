(() => {
  const bar = document.createElement('div');
  bar.id = 'activity-status';
  bar.className = 'toast hidden';
  bar.innerHTML = `
    <div class="act-status-icon" id="actstatusicon">🎮</div>
    <div class="toast-body">
      <span class="toast-name" id="actstatusname"></span>
      <span class="toast-sub" id="actstatusline"></span>
    </div>
  `;
  document.body.appendChild(bar);
  window.stack?.register(bar, { order: 1 });

  const icon = bar.querySelector('#actstatusicon');
  const name = bar.querySelector('#actstatusname');
  const line = bar.querySelector('#actstatusline');

  const icons = { UNO: '🎴', Browser: '🌐' };

  const sources = new Map();
  setInterval(tick, 500);

  function tick() {
    if (sources.size === 0) {
      bar.classList.add('hidden');
      window.stack?.layout();
      return;
    }
    const fn = [...sources.values()][sources.size - 1];
    const info = fn();
    icon.textContent = icons[info.name] || '';
    name.textContent = info.name;
    line.textContent = info.line;
    bar.classList.remove('hidden');
    window.stack?.layout();
  }

  function set(fn) {
    const probe = fn();
    sources.set(probe.name, fn);
    tick();
  }

  function clear(name) {
    sources.delete(name);
    tick();
  }

  function announce(id) {
    window.toasts?.show({ name: 'Party', activity: `Activity started: ${id}`, status: 'online' });
  }

  window.activity = { set, clear, announce };
})();
