(() => {
  const margin = 18;
  const gap = 10;
  const base = 18;

  const zones = [];

  function register(el, opts = {}) {
    zones.push({ el, order: opts.order ?? zones.length });
    zones.sort((a, b) => a.order - b.order);
  }

  function shown(el) {
    return el && !el.classList.contains('hidden') && el.offsetParent !== null;
  }

  function layout() {
    const party = document.getElementById('partytoast');
    const height = shown(party) ? party.offsetHeight : 0;

    let bottom = base + height + (height ? gap : 0);
    zones.forEach(({ el }) => {
      if (!shown(el)) return;
      el.style.right = `${margin}px`;
      el.style.bottom = `${bottom}px`;
      bottom += el.offsetHeight + gap;
    });
  }

  const observer = new MutationObserver(layout);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });

  window.addEventListener('resize', layout);
  setInterval(layout, 400);

  window.stack = { register, layout };
})();
